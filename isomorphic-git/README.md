# isomorphic-git Skill

Git version control for iOS Scripting app. Stores `.git` directories separately in App Group to avoid iCloud bloat.

## Quick Start

### Initialize a repository
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"init","dir":"/path/to/project","name":"my-project"}' --timeout 30
```

### Stage and commit files
```bash
# Stage a file
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"add","dir":"/path/to/project","filepath":"README.md"}' --timeout 30

# Commit changes
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"commit","dir":"/path/to/project","message":"Initial commit"}' --timeout 30
```

### View history and status
```bash
# View commit log
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"log","dir":"/path/to/project"}' --timeout 30

# Check file status
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"status","dir":"/path/to/project","filepath":"README.md"}' --timeout 30
```

### Branch management
```bash
# List branches
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"branch","dir":"/path/to/project"}' --timeout 30

# Create and switch to new branch
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"branch","dir":"/path/to/project","name":"feature-x"}' --timeout 30

# Switch branch
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"checkout","dir":"/path/to/project","ref":"master"}' --timeout 30
```

### Restore and diff
```bash
# Restore file to last commit
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"restore","dir":"/path/to/project","filepath":"README.md"}' --timeout 30

# View changes
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/to/project"}' --timeout 30
```

### Stash changes
```bash
# Push changes to stash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"push","message":"work in progress"}' --timeout 30

# List stash entries
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"list"}' --timeout 30

# Apply stash (keep in stash)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"apply","refIdx":0}' --timeout 30

# Pop stash (apply and remove)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"pop"}' --timeout 30
```

### Revert a commit
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"revert","dir":"/path/to/project","ref":"HEAD"}' --timeout 30
```

### Repository management
```bash
# List all repositories
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"list"}' --timeout 30

# Remove repository mapping
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"remove","dir":"/path/to/project"}' --timeout 30
```

## Architecture

- **Gitdir location**: `FileManager.appGroupDocumentsDirectory/git-repos/<repoName>/`
- **Workdir**: User-specified project directory
- **Repo mapping**: `FileManager.appGroupDocumentsDirectory/git-repos/repo-map.json`

## Supported Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize a new git repository |
| `add` | Stage files for commit |
| `commit` | Create a new commit |
| `log` | View commit history |
| `status` | Check file status |
| `branch` | Create/list branches |
| `checkout` | Switch branches or restore files |
| `diff` | View file changes |
| `restore` | Restore working tree files |
| `stash` | Stash changes (push/pop/apply/drop/list/clear/create) |
| `revert` | Revert a commit |
| `list` | List all repositories |
| `remove` | Remove repository mapping |

## Testing

Run the test script to verify everything works:
```bash
scripting-ts run <skill_dir>/scripts/test-local-git.ts --timeout 60
```