# 贡献指南

感谢你愿意为 My Digital Library 做贡献。

## 开始之前

1. 阅读 [README.md](README.md)，在本地完成 `npm install` 与 `npm run tauri dev`。
2. 确认你的改动不引入密钥、个人路径或大型二进制（`.app`、`.dmg` 等应通过 [Releases](https://github.com/libindury1978/MyDigitalLibrary/releases) 分发）。
3. **不要提交构建产物**：包括但不限于 `target/`（Rust）、`node_modules/`、`dist/`、`release/`。这些目录已在 `.gitignore` 中；若使用 `git add -A`，提交前请用 `git status` 确认未误加入。
4. 大型功能建议先开 Issue 讨论，避免与维护者方向不一致。

## 开发流程

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run tauri dev

# 类型检查 + 前端构建
npm run build
```

Rust 改动位于 `src-tauri/`。修改命令或权限时，请同步检查 `src-tauri/capabilities/`。

## 提交 Pull Request

1. Fork 仓库并基于 `main`（或默认分支）创建分支，命名建议：`feat/xxx`、`fix/xxx`、`docs/xxx`。
2. 保持 PR 范围聚焦：一个 PR 解决一类问题。
3. 在 PR 描述中说明：
   - **做了什么**
   - **为什么**（关联 Issue 编号如有）
   - **如何验证**（例如：扫描某目录、排序、打开详情预览）
4. 确保 `npm run build` 通过；涉及 Rust 时请确认 `cargo build` 在 `src-tauri` 下无错误。

## 代码风格

- **TypeScript / React**：与现有文件保持一致；优先函数组件与已有 hooks 模式。
- **Rust**：遵循 `rustfmt` 默认风格；错误信息对用户可读（中文或英文均可，与周边一致）。
- **注释**：只为非显而易见的逻辑添加简短说明，避免冗长文档块。

## Issue 规范

- **Bug**：系统版本、复现步骤、期望与实际行为、相关日志或截图。
- **功能请求**：使用场景与可接受的简化方案。

## 许可证

你提交的贡献将按仓库 [Apache License 2.0](LICENSE) 授权；请确保你有权提交相关代码。
