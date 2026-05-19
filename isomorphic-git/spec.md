# isomorphic-git Skill 改造方案

## 1. 核心目标

将 isomorphic-git skill 从测试 demo 改造为真正的 skill，让 LLM 能够调用 Git 版本管理能力。

## 2. 关键需求

### 2.1 功能需求
- 支持 Git 基本操作：init, add, commit, log, status
- 为指定项目生成 Git 版本管理
- .git 目录独立存储（不在工作区目录中）
- 做好项目映射（项目路径 -> gitdir 路径）

### 2.2 架构需求
- 入口脚本：`scripts/git.ts`
- 依赖：isomorphic-git UMD bundle + Buffer polyfill
- 存储：App Group 目录下的 git-repos 子目录
- 映射：通过 repo name 或 hash 建立项目到 gitdir 的映射

### 2.3 接口需求
- 通过 `run_shell_command` 调用
- 参数通过 `--queryparameters` JSON 传递
- 结果通过 `Script.exit()` 返回 JSON

## 3. 实现方案

### 3.1 文件结构
```
isomorphic-git/
├── SKILL.md          # 已有，需更新
├── skill.json        # 已有
├── schema.json       # 新增：输入验证
├── scripts/
│   ├── git.ts        # 新增：主入口脚本
│   ├── polyfills.ts  # 已有
│   └── test-local-git.ts  # 已有，可保留作为测试
└── vendor/
    ├── buffer-bundle.js   # 已有
    └── index.umd.min.js   # 已有
```

### 3.2 项目映射方案
- 使用项目目录的 basename 作为默认 repo name
- 支持自定义 repo name
- gitdir 路径：`FileManager.appGroupDocumentsDirectory + "/git-repos/<repoName>"`
- 映射文件：`FileManager.appGroupDocumentsDirectory + "/git-repos/repo-map.json"`

### 3.3 核心实现
1. **git.ts 入口脚本**
   - 解析命令参数
   - 加载 isomorphic-git 和 Buffer polyfill
   - 创建 FS 适配器（分离 gitdir 和 workdir）
   - 执行对应 Git 操作
   - 返回 JSON 结果

2. **FS 适配器**
   - 复用 test-local-git.ts 中的 createFS 函数
   - 正确路由 .git 内部路径到 gitdir
   - 正确路由项目文件到 workdir

3. **仓库映射管理**
   - 维护 repo-map.json 记录项目路径到 repo name 的映射
   - 支持查询、创建、删除映射

### 3.4 支持的命令

**核心命令**（必须实现）：

| 命令 | 参数 | 说明 |
|------|------|------|
| `init` | dir, name? | 初始化仓库 |
| `add` | dir, filepath | 暂存文件 |
| `commit` | dir, message, author | 提交更改 |
| `log` | dir, depth? | 查看提交历史 |
| `status` | dir, filepath | 查看文件状态 |
| `branch` | dir, name?, checkout? | 创建/列出分支 |
| `checkout` | dir, ref, filepath? | 切换分支/恢复文件 |
| `diff` | dir, filepath?, refA?, refB? | 查看文件差异 |
| `restore` | dir, filepath | 撤销工作区更改 |
| `stash` | dir, op?, message?, refIdx? | 暂存更改 (push/pop/apply/drop/list/clear/create) |
| `revert` | dir, ref, author? | 撤销提交 |
| `list` | - | 列出所有仓库 |
| `remove` | dir 或 name | 删除仓库映射 |

**远程与标签命令**（新增）：

| 命令 | 参数 | 说明 |
|------|------|------|
| `remote` | dir, op?, remote?, url? | 管理远程仓库 (add/remove/list) |
| `push` | dir, remote?, ref?, force?, username?, password? | 推送到远程仓库 |
| `pull` | dir, remote?, ref?, author?, username?, password? | 从远程仓库拉取 |
| `clone` | dir, url, remote?, ref?, depth?, singleBranch?, noCheckout?, username?, password? | 克隆远程仓库 |
| `tag` | dir, op?, tag?, message?, oid?, lightweight? | 管理标签 (create/list/delete) |

## 4. 验证方式

1. 运行现有测试：`scripting-ts run <skill_dir>/scripts/test-local-git.ts`
2. 手动测试各命令
3. 验证 .git 目录确实不在工作区中

## 5. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Buffer polyfill 兼容性 | 复用已验证的 polyfills.ts |
| isomorphic-git UMD 加载失败 | 添加错误处理和日志 |
| 项目映射文件损坏 | 添加备份和恢复机制 |
| 大文件性能问题 | 添加文件大小限制和警告 |

## 6. Done Contract

- [x] `scripts/git.ts` 入口脚本创建完成
- [x] `schema.json` 输入验证文件创建完成
- [x] `SKILL.md` 更新为完整文档
- [x] 所有 Git 命令（init, add, commit, log, status, branch, checkout, diff, restore, stash, revert, remote, push, pull, clone, tag）正常工作
- [x] .git 目录正确存储在 App Group 目录
- [x] 项目映射机制正常工作
- [x] clone 命令成功从 GitHub 克隆公共仓库
- [x] remote 命令支持 add/remove/list 操作
- [x] tag 命令支持 create/list/delete 操作（含 annotated 和 lightweight）
- [x] push/pull 命令实现（需要 HTTP 认证）
- [x] HTTP 传输适配器使用 fetch API，修复了 Scripting 环境下 Uint8Array body 不兼容的问题
- [x] 测试通过

## 7. 关键技术发现

### 7.1 fetch API Uint8Array body 兼容性问题
Scripting 环境下的 `fetch` API 不支持直接传递 `Uint8Array` 作为 POST body（返回 0 字节响应）。解决方案：将 body 转换为 `latin1` 字符串后传递。

### 7.2 FS 适配器 rmdir/unlink 容错
clean clone 过程中会尝试删除不存在的 shallow 文件，需要 `rmdir`/`unlink` 在文件不存在时不抛出错误。