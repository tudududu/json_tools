# Workspace-specific zshrc to show a single venv indicator via prompt,
# preserving VS Code shell integration and your global ~/.zshrc.

# 1) Preserve user's own zsh settings (themes, plugins, integration)
if [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc"
fi

# 2) Prevent Python's activation scripts from modifying the prompt
export VIRTUAL_ENV_DISABLE_PROMPT=1

# 3) Add a small venv segment to the prompt when VIRTUAL_ENV is set
_venv_prefix() {
  if [[ -n "$VIRTUAL_ENV" ]]; then
    print -r -- "(${VIRTUAL_ENV:t}) "
  fi
}

# Install the venv prefix only once per shell
if [[ -z "${_VENV_PROMPT_INSTALLED:-}" ]]; then
  export _VENV_PROMPT_INSTALLED=1
  PROMPT='$(_venv_prefix)'"$PROMPT"
fi
