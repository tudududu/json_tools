# Workspace-specific zshrc to activate venv while preserving VS Code shell integration and user config.

# 1) Preserve VS Code shell integration and user's own zsh settings
if [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc"
fi

# 2) Activate this workspace's virtual environment if present
WORKDIR="${WORKSPACE_FOLDER:-$PWD}"
if [ -f "$WORKDIR/.venv/bin/activate" ]; then
  source "$WORKDIR/.venv/bin/activate"
fi
