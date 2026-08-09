export type GerritPatchAction = 'align' | 'cherryPick';

export type GerritFetchCommand = {
  remote: string;
  ref: string;
};

/**
 * Parse the command copied from Gerrit's Download/Checkout menu without
 * executing it through a shell. Only the fetch target and patch ref are kept.
 */
export function parseGerritFetchCommand(input: string): GerritFetchCommand {
  const tokens = tokenizeCommand(input.trim());
  const checkoutSuffix = ['&&', 'git', 'checkout', 'FETCH_HEAD'];
  const hasCheckoutSuffix =
    tokens.length === 8 && checkoutSuffix.every((token, index) => tokens[index + 4] === token);

  if (tokens.length !== 4 && !hasCheckoutSuffix) {
    throw new Error('Expected: git fetch <remote-or-url> <refs/...> && git checkout FETCH_HEAD');
  }

  if (tokens[0] !== 'git' || tokens[1] !== 'fetch') {
    throw new Error('The command must start with "git fetch".');
  }

  const remote = tokens[2];
  const ref = tokens[3];
  if (!isValidRemote(remote)) {
    throw new Error('The fetch remote or URL is invalid.');
  }
  if (!isValidFetchRef(ref)) {
    throw new Error('The patch ref must be a valid refs/... value.');
  }

  return { remote, ref };
}

export function buildPatchApplyArgs(action: GerritPatchAction, currentBranch: string): string[] {
  if (action === 'align') {
    if (!currentBranch || currentBranch === 'HEAD') {
      throw new Error('Aligning a patch requires a checked-out local branch.');
    }
    return ['checkout', '-m', '-B', currentBranch, 'FETCH_HEAD'];
  }

  return ['cherry-pick', 'FETCH_HEAD'];
}

function isValidRemote(remote: string): boolean {
  return (
    remote.length > 0 &&
    !remote.startsWith('-') &&
    !/\s/.test(remote) &&
    !remote.toLowerCase().startsWith('ext::')
  );
}

function isValidFetchRef(ref: string): boolean {
  return (
    /^refs\/[A-Za-z0-9._/-]+$/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('@{') &&
    !ref.endsWith('.') &&
    !ref.endsWith('/') &&
    !ref.includes('//')
  );
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let tokenStarted = false;
  let quote: 'single' | 'double' | undefined;
  let escaped = false;

  const finishToken = () => {
    if (tokenStarted) {
      tokens.push(current);
      current = '';
      tokenStarted = false;
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (quote === 'single') {
      if (character === "'") {
        quote = undefined;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }

    if (quote === 'double') {
      if (character === '"') {
        quote = undefined;
      } else if (character === '\\') {
        escaped = true;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      finishToken();
    } else if (character === "'") {
      quote = 'single';
      tokenStarted = true;
    } else if (character === '"') {
      quote = 'double';
      tokenStarted = true;
    } else if (character === '\\') {
      escaped = true;
      tokenStarted = true;
    } else if (character === '&' && command[index + 1] === '&') {
      finishToken();
      tokens.push('&&');
      index += 1;
    } else {
      current += character;
      tokenStarted = true;
    }
  }

  if (quote || escaped) {
    throw new Error('The command contains an unfinished quote or escape.');
  }

  finishToken();
  return tokens;
}
