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

# 4) History: only store the first occurrence of an exact command
#    Skip adding duplicates (within this session) and respect existing history file
setopt HIST_IGNORE_SPACE       # don't record commands starting with a space
setopt HIST_IGNORE_DUPS        # ignore consecutive duplicates (belt-and-suspenders)
setopt HIST_FIND_NO_DUPS       # skip duplicates during history search
setopt HIST_SAVE_NO_DUPS       # prune duplicates on save (keeps newest if any slipped through)

# Pre-seed seen commands from HISTFILE (supports extended history format)
typeset -g -A __WS_SEEN_CMDS
if [[ -z ${__WS_SEEN_INIT_DONE:-} ]]; then
  __WS_SEEN_INIT_DONE=1
  if [[ -n $HISTFILE && -r $HISTFILE ]]; then
    local __line __cmd
    while IFS= read -r __line; do
      if [[ $__line == :* ]]; then
        __cmd=${__line##*;}
      else
        __cmd=$__line
      fi
      # normalize trailing spaces
      __cmd=${__cmd%%[[:space:]]}
      [[ -n $__cmd ]] && __WS_SEEN_CMDS[$__cmd]=1
    done < "$HISTFILE"
  fi
fi

# zsh hook to decide if a command should be added to history
function zshaddhistory() {
  emulate -L zsh
  setopt extendedglob
  local __line="$1"
  # ignore empty/whitespace-only
  [[ -z ${__line//[[:space:]]/} ]] && return 1
  # if we've seen this exact command before (from file or this session), skip adding
  if [[ -n ${__WS_SEEN_CMDS[$__line]:-} ]]; then
    return 1
  fi
  __WS_SEEN_CMDS[$__line]=1
  return 0
}
