use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaItem {
    id: String,
    category: String,
    title: String,
    path: String,
    extension: String,
    /// 毫秒时间戳：优先文件创建时间（birthtime），不可用时回退为修改时间。
    created_at: i64,
}

fn detect_category(ext: &str) -> Option<&'static str> {
    let lower = ext.to_lowercase();
    if ["mp4", "mov", "mkv", "avi", "webm", "m4v"].contains(&lower.as_str()) {
        return Some("视频");
    }
    if ["mp3", "wav", "flac", "aac", "m4a", "ogg"].contains(&lower.as_str()) {
        return Some("音频");
    }
    if ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"].contains(&lower.as_str()) {
        return Some("图片");
    }
    if ["md", "txt", "pdf", "doc", "docx", "rtf"].contains(&lower.as_str()) {
        return Some("文章");
    }
    None
}

fn walk_files(dir: &Path, output: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_files(&path, output);
            } else {
                output.push(path);
            }
        }
    }
}

fn system_time_to_unix_ms(t: std::time::SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => {
            let ms = d.as_millis();
            if ms > i64::MAX as u128 {
                i64::MAX
            } else {
                ms as i64
            }
        }
        Err(_) => 0,
    }
}

/// 用于排序：优先 `created`（macOS/Windows 等常见为 birthtime），否则用 `modified`。
fn file_created_ms_for_sort(path: &Path) -> i64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    if let Ok(t) = meta.created() {
        return system_time_to_unix_ms(t);
    }
    meta.modified()
        .map(system_time_to_unix_ms)
        .unwrap_or(0)
}

fn to_media_item(path: &Path) -> Option<MediaItem> {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_string();
    let category = detect_category(&ext)?;
    let title = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("未命名文件")
        .to_string();
    let path_str = path.to_string_lossy().to_string();
    let created_at = file_created_ms_for_sort(path);
    Some(MediaItem {
        id: path_str.clone(),
        category: category.to_string(),
        title,
        path: path_str,
        extension: ext.to_lowercase(),
        created_at,
    })
}

#[tauri::command]
fn scan_library(root_path: String) -> Result<Vec<MediaItem>, String> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err("所选路径不是有效文件夹".to_string());
    }

    let mut file_paths = Vec::new();
    walk_files(&root, &mut file_paths);

    let mut items = Vec::new();
    for path in file_paths {
        if let Some(item) = to_media_item(&path) {
            items.push(item);
        }
    }

    Ok(items)
}

#[tauri::command]
fn add_files(paths: Vec<String>) -> Result<Vec<MediaItem>, String> {
    let mut items = Vec::new();
    for raw_path in paths {
        let path = PathBuf::from(raw_path);
        if !path.exists() || !path.is_file() {
            continue;
        }
        if let Some(item) = to_media_item(&path) {
            items.push(item);
        }
    }
    Ok(items)
}

#[tauri::command]
fn move_media_file(from_path: String, to_dir: String) -> Result<MediaItem, String> {
    let source = PathBuf::from(&from_path);
    if !source.exists() || !source.is_file() {
        return Err("源文件不存在".to_string());
    }
    let target_dir = PathBuf::from(&to_dir);
    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| format!("创建目标目录失败: {e}"))?;
    }
    if !target_dir.is_dir() {
        return Err("目标路径不是文件夹".to_string());
    }

    let file_name = source
        .file_name()
        .ok_or_else(|| "无法读取源文件名".to_string())?;
    let mut target = target_dir.join(file_name);

    if target.exists() {
        let stem = source
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or("文件")
            .to_string();
        let ext = source
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| format!(".{v}"))
            .unwrap_or_default();
        let mut i = 1;
        loop {
            let candidate = target_dir.join(format!("{stem}_moved_{i}{ext}"));
            if !candidate.exists() {
                target = candidate;
                break;
            }
            i += 1;
        }
    }

    fs::rename(&source, &target).map_err(|e| format!("移动文件失败: {e}"))?;
    to_media_item(&target).ok_or_else(|| "移动成功，但文件类型不受支持".to_string())
}

#[tauri::command]
fn delete_media_file(path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Ok(());
    }
    if !target.is_file() {
        return Err("目标不是文件".to_string());
    }
    fs::remove_file(target).map_err(|e| format!("删除文件失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn share_file(window: tauri::Window, path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::base::{id, nil};
        use cocoa::foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};
        use objc::{class, msg_send, sel, sel_impl};

        let p = PathBuf::from(&path);
        if !p.exists() {
            return Err("文件不存在，无法分享".to_string());
        }

        let ns_window_ptr = window
            .ns_window()
            .map_err(|_| "无法获取窗口句柄".to_string())?;
        let ns_window = ns_window_ptr as id;

        unsafe {
            let ns_path = NSString::alloc(nil).init_str(&path);
            let url = NSURL::fileURLWithPath_(nil, ns_path);
            let items = NSArray::arrayWithObject(nil, url);

            let picker: id = msg_send![class!(NSSharingServicePicker), alloc];
            let picker: id = msg_send![picker, initWithItems: items];

            let view: id = msg_send![ns_window, contentView];
            let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
            // preferredEdge: 3 == NSMaxYEdge
            let preferred_edge: i64 = 3;
            let _: () = msg_send![picker, showRelativeToRect: rect ofView: view preferredEdge: preferred_edge];
        }

        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        let _ = path;
        Err("系统分享仅支持 macOS".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_library,
            add_files,
            move_media_file,
            delete_media_file,
            share_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
