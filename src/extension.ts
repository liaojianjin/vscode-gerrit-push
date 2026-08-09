import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildPatchApplyArgs, GerritPatchAction, parseGerritFetchCommand } from './gerritPatch';

type GitRunResult = {
  stdout: string;
  stderr: string;
};

type BranchPick = vscode.QuickPickItem & { value: string };
type RemotePick = vscode.QuickPickItem & { value: string };
type PatchActionPick = vscode.QuickPickItem & { value: GerritPatchAction };

// 国际化文本
const i18n = {
  en: {
    outputChannelName: 'Gerrit Push',
    noGitRepo: 'No git repository found. Please switch to a directory with .git and try again.',
    noGitRemote: 'No git remotes found for Gerrit push.',
    selectBranchTitle: 'Select or enter target branch (refs/for/<branch>)',
    selectBranchPlaceholder: 'Enter branch/ref or select from recommendations below',
    selectRemotePlaceholder: 'Select remote to push to Gerrit',
    confirmTitle: 'Confirm Gerrit Push',
    confirmPlaceholder: 'Select to confirm or cancel',
    pushButton: '$(check) Push',
    pushButtonMsg: 'Push',
    pushButtonDesc: 'Confirm and push',
    cancelButton: '$(x) Cancel',
    cancelButtonMsg: 'Cancel',
    cancelButtonDesc: 'Discard changes',
    pushConfirmMessage: (branch: string, remote: string, repo?: string, reviewers?: string) => {
      const lines = [
        `Push to:`,
        `  Branch: ${branch}`,
        `  Remote: ${remote}`
      ];
      if (repo) {
        lines.push(`  Repo: ${repo}`);
      }
      if (reviewers) {
        lines.push(`  Reviewers: ${reviewers}`);
      }
      return lines.join('\n');
    },
    currentBranch: 'Use current branch',
    defaultBranch: 'Use configured default branch',
    localBranch: 'Local branch',
    remoteBranch: 'Remote branch',
    pushDetailsTitle: 'Push Details',
    currentBranchLabel: 'Current Branch',
    targetBranchLabel: 'Target Branch',
    remoteNameLabel: 'Remote Name',
    remoteUrlLabel: 'Remote URL',
    pushRefLabel: 'Push Ref',
    reviewersLabel: 'Reviewers',
    pushingTitle: (ref: string, remote: string) => `Pushing ${ref} to ${remote}`,
    pushSuccessMessage: (remote: string, branch: string) => `Pushed HEAD to ${remote} refs/for/${branch}`,
    reviewerInputTitle: 'Add reviewers',
    reviewerInputPlaceholder: 'Enter reviewers (comma or space separated, optional)',
    reviewerSelectTitle: 'Select reviewers',
    reviewerSelectPlaceholder: 'Pick presets or type to add reviewers',
    reviewerPresetDescription: 'Preset reviewer',
    reviewerNoneLabel: 'No reviewers',
    reviewerNoneDescription: 'Push without reviewers',
    patchCommandTitle: 'Apply a Gerrit patch',
    patchCommandPrompt: 'Paste the Checkout command copied from Gerrit',
    patchCommandPlaceholder: 'git fetch <remote-or-url> refs/changes/... && git checkout FETCH_HEAD',
    patchActionTitle: 'How do you want to apply the Gerrit patch?',
    patchActionPlaceholder: 'Select an action for FETCH_HEAD',
    patchAlignLabel: (branch: string) => `$(git-branch) Align current branch (${branch})`,
    patchAlignDescription: 'Move the current branch to the patch and merge local changes',
    patchCherryPickLabel: '$(git-commit) Cherry-pick onto current branch',
    patchCherryPickDescription: 'Keep the current branch history and append the patch commit',
    patchDetachedHead: 'Aligning a patch requires a checked-out local branch.',
    patchProgressTitle: (ref: string) => `Fetching and applying ${ref}`,
    patchAlignSuccess: (branch: string) => `Aligned ${branch} to the Gerrit patch.`,
    patchCherryPickSuccess: (branch: string) => `Cherry-picked the Gerrit patch onto ${branch}.`
  },
  zh: {
    outputChannelName: 'Gerrit Push',
    noGitRepo: '未找到可用的 Git 仓库，请切换到包含 .git 的目录后重试。',
    noGitRemote: '未找到 Git Remote，无法执行 Gerrit push。',
    selectBranchTitle: '选择或输入目标分支 (refs/for/<branch>)',
    selectBranchPlaceholder: '输入分支/引用，或选择下方推荐项',
    selectRemotePlaceholder: '选择要推送到的 Remote',
    confirmTitle: '确认 Gerrit Push',
    confirmPlaceholder: '选择确认或取消',
    pushButton: '$(check) Push',
    pushButtonMsg: 'Push',
    pushButtonDesc: '确认并推送',
    cancelButton: '$(x) Cancel',
    cancelButtonMsg: '取消',
    cancelButtonDesc: '取消此次推送',
    pushConfirmMessage: (branch: string, remote: string, repo?: string, reviewers?: string) => {
      const lines = [
        `推送到:`,
        `  分支: ${branch}`,
        `  Remote: ${remote}`
      ];
      if (repo) {
        lines.push(`  Repo: ${repo}`);
      }
      if (reviewers) {
        lines.push(`  Reviewer: ${reviewers}`);
      }
      return lines.join('\n');
    },
    currentBranch: '使用当前分支',
    defaultBranch: '使用配置的默认分支',
    localBranch: '本地分支',
    remoteBranch: 'Remote 分支',
    pushDetailsTitle: 'Push 详情',
    currentBranchLabel: '当前分支',
    targetBranchLabel: '目标分支',
    remoteNameLabel: 'Remote 名称',
    remoteUrlLabel: 'Remote URL',
    pushRefLabel: 'Push Ref',
    reviewersLabel: 'Reviewer',
    pushingTitle: (ref: string, remote: string) => `推送 ${ref} 到 ${remote}`,
    pushSuccessMessage: (remote: string, branch: string) => `已推送 HEAD 到 ${remote} refs/for/${branch}`,
    reviewerInputTitle: '添加 Reviewer',
    reviewerInputPlaceholder: '输入 reviewer（逗号或空格分隔，可留空）',
    reviewerSelectTitle: '选择 Reviewer',
    reviewerSelectPlaceholder: '选择预设或直接输入 reviewer',
    reviewerPresetDescription: '预设 reviewer',
    reviewerNoneLabel: '不添加 reviewer',
    reviewerNoneDescription: '不指定 reviewer 推送',
    patchCommandTitle: '应用 Gerrit Patch',
    patchCommandPrompt: '粘贴从 Gerrit 复制的 Checkout 命令',
    patchCommandPlaceholder: 'git fetch <remote-or-url> refs/changes/... && git checkout FETCH_HEAD',
    patchActionTitle: '如何应用 Gerrit Patch？',
    patchActionPlaceholder: '选择 FETCH_HEAD 的应用方式',
    patchAlignLabel: (branch: string) => `$(git-branch) 对齐当前分支 (${branch})`,
    patchAlignDescription: '将当前分支移动到 Patch，并用 merge 保留本地修改',
    patchCherryPickLabel: '$(git-commit) Cherry-pick 到当前分支',
    patchCherryPickDescription: '保留当前分支历史，并追加 Patch 提交',
    patchDetachedHead: '对齐 Patch 需要先 checkout 到一个本地分支。',
    patchProgressTitle: (ref: string) => `正在获取并应用 ${ref}`,
    patchAlignSuccess: (branch: string) => `已将 ${branch} 对齐到 Gerrit Patch。`,
    patchCherryPickSuccess: (branch: string) => `已将 Gerrit Patch cherry-pick 到 ${branch}。`
  }
};

function getLanguage(): 'en' | 'zh' {
  const language = vscode.env.language;
  return language.startsWith('zh') ? 'zh' : 'en';
}

function getText(key: string): any {
  const lang = getLanguage();
  return (i18n[lang as keyof typeof i18n] as any)[key];
}

// 输出 Gerrit push 相关日志
const outputChannel = vscode.window.createOutputChannel(getText('outputChannelName') as string);

export function activate(context: vscode.ExtensionContext) {
  const pushDisposable = vscode.commands.registerCommand('gerritPush.pushToGerrit', async (sourceControl?: any) => {
    try {
      await pushToGerrit(sourceControl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`Error: ${message}`);
      vscode.window.showErrorMessage(`Gerrit push failed: ${message}`);
    }
  });

  const patchDisposable = vscode.commands.registerCommand('gerritPush.applyGerritPatch', async (sourceControl?: any) => {
    try {
      await applyGerritPatch(sourceControl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`Error: ${message}`);
      outputChannel.show(true);
      vscode.window.showErrorMessage(`Gerrit patch failed: ${message}`);
    }
  });

  context.subscriptions.push(pushDisposable, patchDisposable, outputChannel);
}

export function deactivate() {
  // Nothing to clean up
}

async function pushToGerrit(sourceControl?: any) {
  const gitRoot = await resolveRepositoryRoot(sourceControl);

  if (!gitRoot) {
    vscode.window.showErrorMessage(getText('noGitRepo'));
    return;
  }

  const cwd = gitRoot;
  
  // 获取配置：优先使用活跃编辑器所在的 folder，否则使用第一个 folder
  let configFolder = vscode.workspace.workspaceFolders?.[0];
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const editorFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (editorFolder) {
      configFolder = editorFolder;
    }
  }
  
  const config = vscode.workspace.getConfiguration('gerritPush', configFolder?.uri);
  const defaultBranch = config.get<string>('defaultBranch', '').trim();
  const remoteFromConfig = config.get<string>('remote', 'origin').trim() || 'origin';
  const confirmBeforePush = config.get<boolean>('confirmBeforePush', true);
  const confirmationStyle = config.get<'quickpick' | 'message'>('confirmationStyle', 'quickpick');
  const compactRemoteUrl = config.get<boolean>('compactRemoteUrl', false);
  const reviewerPresets = config.get<string[]>('reviewerPresets', [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const enableReviewers = config.get<boolean>('enableReviewers', false);

  // 计算目标 refs/for/<branch>
  const currentBranch = await getCurrentBranch(cwd);
  
  // 先选择 remote，以便获取该 remote 的分支列表
  const remote = await chooseRemote(remoteFromConfig, cwd);
  if (!remote) {
    return;
  }
  
  const branch = await chooseBranch(currentBranch, defaultBranch, remote, cwd);
  if (!branch) {
    return;
  }

  let reviewers: string[] = [];
  if (enableReviewers) {
    const reviewerInput = await promptReviewers(reviewerPresets);
    if (reviewerInput === undefined) {
      return;
    }
    reviewers = normalizeReviewers(reviewerInput);
  }
  const pushRef = buildPushRef(branch, reviewers);
  outputChannel.show(true);

  const remoteUrl = await getRemoteUrl(remote, cwd);

  // 在输出窗口显示详细信息
  outputChannel.appendLine('');
  outputChannel.appendLine('═══════════════════════════════════════');
  outputChannel.appendLine(`Push Details:`);
  outputChannel.appendLine(`  Current Branch: ${currentBranch}`);
  outputChannel.appendLine(`  Target Branch:  ${branch}`);
  outputChannel.appendLine(`  Remote Name:    ${remote}`);
  if (remoteUrl) {
    outputChannel.appendLine(`  Remote URL:     ${remoteUrl}`);
  }
  outputChannel.appendLine(`  Push Ref:       ${pushRef}`);
  if (reviewers.length > 0) {
    outputChannel.appendLine(`  Reviewers:      ${formatReviewers(reviewers)}`);
  }
  outputChannel.appendLine('═══════════════════════════════════════');
  outputChannel.appendLine('');

  // 显式确认，避免误推
  if (confirmBeforePush) {
    const confirmed = await showPushConfirmation(
      branch,
      remote,
      remoteUrl,
      reviewers,
      confirmationStyle,
      compactRemoteUrl
    );
    if (!confirmed) {
      return;
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Pushing ${pushRef} to ${remote}`,
      cancellable: false
    },
    async () => {
      outputChannel.appendLine(`> git push ${remote} ${pushRef}`);
      const result = await runGit(['push', remote, pushRef], cwd, true);
      if (result.stdout.trim()) {
        outputChannel.appendLine(result.stdout.trim());
      }
      if (result.stderr.trim()) {
        outputChannel.appendLine(result.stderr.trim());
      }
    }
  );

  vscode.window.showInformationMessage(`Pushed HEAD to ${remote} refs/for/${branch}`);
}

async function applyGerritPatch(sourceControl?: any) {
  const cwd = await resolveRepositoryRoot(sourceControl);
  if (!cwd) {
    vscode.window.showErrorMessage(getText('noGitRepo'));
    return;
  }

  const clipboardText = await vscode.env.clipboard.readText();
  const clipboardCommand = isGerritFetchCommand(clipboardText) ? clipboardText.trim() : '';
  const command = await vscode.window.showInputBox({
    title: getText('patchCommandTitle'),
    prompt: getText('patchCommandPrompt'),
    placeHolder: getText('patchCommandPlaceholder'),
    value: clipboardCommand,
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        parseGerritFetchCommand(value);
        return undefined;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }
  });
  if (command === undefined) {
    return;
  }

  const fetchCommand = parseGerritFetchCommand(command);
  const currentBranch = await getCurrentBranch(cwd);
  const action = await choosePatchAction(currentBranch);
  if (!action) {
    return;
  }
  if (action === 'align' && currentBranch === 'HEAD') {
    vscode.window.showErrorMessage(getText('patchDetachedHead'));
    return;
  }

  const applyArgs = buildPatchApplyArgs(action, currentBranch);
  outputChannel.show(true);
  outputChannel.appendLine('');
  outputChannel.appendLine('═══════════════════════════════════════');
  outputChannel.appendLine('Gerrit Patch Details:');
  outputChannel.appendLine(`  Current Branch: ${currentBranch}`);
  outputChannel.appendLine(`  Fetch Remote:   ${fetchCommand.remote}`);
  outputChannel.appendLine(`  Fetch Ref:      ${fetchCommand.ref}`);
  outputChannel.appendLine(`  Action:         ${action === 'align' ? 'Align current branch' : 'Cherry-pick'}`);
  outputChannel.appendLine('═══════════════════════════════════════');
  outputChannel.appendLine('');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: getText('patchProgressTitle')(fetchCommand.ref),
      cancellable: false
    },
    async () => {
      outputChannel.appendLine(`> git fetch ${formatCommandArg(fetchCommand.remote)} ${formatCommandArg(fetchCommand.ref)}`);
      await runGit(['fetch', fetchCommand.remote, fetchCommand.ref], cwd, true);
      outputChannel.appendLine(`> git ${applyArgs.map(formatCommandArg).join(' ')}`);
      await runGit(applyArgs, cwd, true);
    }
  );

  const successMessage = action === 'align'
    ? getText('patchAlignSuccess')(currentBranch)
    : getText('patchCherryPickSuccess')(currentBranch);
  vscode.window.showInformationMessage(successMessage);
}

async function resolveRepositoryRoot(sourceControl?: any): Promise<string | undefined> {
  if (sourceControl?.rootUri?.fsPath) {
    const gitRoot = sourceControl.rootUri.fsPath;
    outputChannel.appendLine(`Using repository from SCM context: ${gitRoot}`);
    return gitRoot;
  }

  const activeEditor = vscode.window.activeTextEditor;
  const cwd = activeEditor?.document.uri.fsPath
    ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  return cwd ? resolveGitRoot(cwd) : undefined;
}

async function choosePatchAction(currentBranch: string): Promise<GerritPatchAction | undefined> {
  const picks: PatchActionPick[] = [];
  if (currentBranch !== 'HEAD') {
    picks.push({
      label: getText('patchAlignLabel')(currentBranch),
      description: getText('patchAlignDescription'),
      detail: `git checkout -m -B ${currentBranch} FETCH_HEAD`,
      value: 'align'
    });
  }
  picks.push({
    label: getText('patchCherryPickLabel'),
    description: getText('patchCherryPickDescription'),
    detail: 'git cherry-pick FETCH_HEAD',
    value: 'cherryPick'
  });

  const selection = await vscode.window.showQuickPick(picks, {
    title: getText('patchActionTitle'),
    placeHolder: getText('patchActionPlaceholder'),
    ignoreFocusOut: true
  });
  return selection?.value;
}

function isGerritFetchCommand(command: string): boolean {
  try {
    parseGerritFetchCommand(command);
    return true;
  } catch {
    return false;
  }
}

function formatCommandArg(arg: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function resolveGitRoot(cwd: string): Promise<string | undefined> {
  // 尝试定位 git 仓库根目录，避免工作区包含多个 git 仓库时用错路径
  try {
    const result = await runGit(['rev-parse', '--show-toplevel'], cwd);
    const root = result.stdout.trim();
    return root || undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to resolve git root in ${cwd}: ${message}`);
    return undefined;
  }
}

async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const branch = result.stdout.trim();
  if (!branch) {
    throw new Error('Unable to determine current branch.');
  }
  return branch;
}

async function chooseBranch(currentBranch: string, defaultBranch: string, remote: string, cwd: string): Promise<string | undefined> {
  const addedBranches = new Set<string>();
  const picks: BranchPick[] = [
    {
      label: `$(git-branch) ${currentBranch}`,
      description: 'Use current branch',
      value: currentBranch
    }
  ];
  addedBranches.add(currentBranch);

  if (defaultBranch && defaultBranch !== currentBranch) {
    picks.push({
      label: `$(rocket) ${defaultBranch}`,
      description: 'Use configured default branch',
      value: defaultBranch
    });
    addedBranches.add(defaultBranch);
  }

  // 优先展示本地分支，再展示远程分支
  const localBranches = await listLocalBranches(cwd);
  for (const branch of localBranches) {
    if (!addedBranches.has(branch)) {
      picks.push({
        label: `$(git-branch) ${branch}`,
        description: getText('localBranch'),
        value: branch
      });
      addedBranches.add(branch);
    }
  }

  const remoteBranches = await listRemoteBranches(remote, cwd);
  for (const branch of remoteBranches) {
    if (!addedBranches.has(branch)) {
      picks.push({
        label: `$(cloud) ${branch}`,
        description: `Remote branch: ${remote}/${branch}`,
        value: branch
      });
      addedBranches.add(branch);
    }
  }

  // 用自定义 QuickPick，允许直接输入分支名后回车
  const qp = vscode.window.createQuickPick<BranchPick>();
  qp.title = getText('selectBranchTitle');
  qp.placeholder = getText('selectBranchPlaceholder');
  qp.items = picks;
  qp.value = defaultBranch || currentBranch;

  return await new Promise<string | undefined>((resolve) => {
    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      const inputValue = qp.value.trim();
      if (selected) {
        resolve(selected.value);
      } else if (inputValue.length > 0) {
        resolve(inputValue);
      } else {
        resolve(undefined);
      }
      qp.hide();
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
}

async function listLocalBranches(cwd: string): Promise<string[]> {
  try {
    const result = await runGit(['branch', '--format=%(refname:short)'], cwd);
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to list local branches: ${message}`);
    return [];
  }
}

async function listRemoteBranches(remote: string, cwd: string): Promise<string[]> {
  try {
    const result = await runGit(['branch', '-r'], cwd);
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    
    const prefix = `${remote}/`;
    const branches = lines
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.substring(prefix.length))
      .filter((branch) => !branch.startsWith('HEAD')); // 过滤掉 HEAD 指针（包括 HEAD -> ... 格式）
    
    return branches;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to list remote branches for ${remote}: ${message}`);
    return [];
  }
}

async function chooseRemote(remoteFromConfig: string, cwd: string): Promise<string | undefined> {
  const remoteList = await listRemotes(cwd);
  if (remoteList.includes(remoteFromConfig)) {
    return remoteFromConfig;
  }

  if (remoteList.length === 0) {
    vscode.window.showErrorMessage(getText('noGitRemote'));
    return undefined;
  }

  if (remoteList.length === 1) {
    return remoteList[0];
  }

  const picks: RemotePick[] = remoteList.map((remote) => ({
    label: remote,
    description: remote === remoteFromConfig ? 'Configured remote' : '',
    value: remote
  }));

  const selection = await vscode.window.showQuickPick(picks, {
    placeHolder: getText('selectRemotePlaceholder')
  });

  return selection?.value;
}

async function listRemotes(cwd: string): Promise<string[]> {
  try {
    const remotes = await runGit(['remote'], cwd);
    return remotes.stdout
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to list remotes: ${message}`);
    return [];
  }
}

async function getRemoteUrl(remote: string, cwd: string): Promise<string | undefined> {
  try {
    const result = await runGit(['remote', 'get-url', remote], cwd);
    return result.stdout.trim() || undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Failed to get remote url for ${remote}: ${message}`);
    return undefined;
  }
}

async function showPushConfirmation(
  branch: string,
  remote: string,
  remoteUrl: string | undefined,
  reviewers: string[],
  style: 'quickpick' | 'message',
  compactUrl: boolean
): Promise<boolean> {
  if (style === 'message') {
    return showMessageConfirmation(branch, remote, remoteUrl, reviewers, compactUrl);
  } else {
    return showQuickPickConfirmation(branch, remote, remoteUrl, reviewers, compactUrl);
  }
}

async function showQuickPickConfirmation(
  branch: string,
  remote: string,
  remoteUrl: string | undefined,
  reviewers: string[],
  compactUrl: boolean
): Promise<boolean> {
  type ConfirmPick = vscode.QuickPickItem & { value: boolean };

  // 构建详细信息
  const details: string[] = [
    `Branch: ${branch}`,
    `Remote: ${remote}`
  ];
  if (remoteUrl) {
    const displayUrl = compactUrl ? extractRepoName(remoteUrl) : remoteUrl;
    details.push(`URL: ${displayUrl}`);
  }
  if (reviewers.length > 0) {
    details.push(`Reviewers: ${formatReviewers(reviewers)}`);
  }

  const picks: ConfirmPick[] = [
    {
      label: '$(check) Push',
      description: 'Confirm and push',
      detail: details.join(' • '),
      value: true
    },
    {
      label: '$(x) Cancel',
      description: 'Discard changes',
      detail: '',
      value: false
    }
  ];

  const qp = vscode.window.createQuickPick<ConfirmPick>();
  qp.title = getText('confirmTitle');
  qp.items = picks;
  qp.placeholder = getText('confirmPlaceholder');

  return await new Promise<boolean>((resolve) => {
    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      resolve(selected?.value ?? false);
      qp.hide();
    });
    qp.onDidHide(() => resolve(false));
    qp.show();
  });
}

async function showMessageConfirmation(
  branch: string,
  remote: string,
  remoteUrl: string | undefined,
  reviewers: string[],
  compactUrl: boolean
): Promise<boolean> {
  const displayUrl = remoteUrl ? (compactUrl ? extractRepoName(remoteUrl) : remoteUrl) : '';
  const reviewerText = reviewers.length > 0 ? formatReviewers(reviewers) : undefined;
  const confirmMessage = getText('pushConfirmMessage')(branch, remote, displayUrl || undefined, reviewerText);
  
  const confirm = await vscode.window.showWarningMessage(
    confirmMessage,
    { modal: true },
    getText('pushButtonMsg')
  );
  return confirm === getText('pushButtonMsg');
}

function extractRepoName(url: string): string {
  // 移除 .git 后缀
  url = url.replace(/\.git\/?$/, '');
  
  // 获取最后一个 / 或 : 之后的部分
  const match = url.match(/[/:]+([^/:]+)$/);
  if (match) {
    return match[1];
  }
  
  return url;
}

function normalizeReviewers(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => item.replace(/^r=/i, ''));
}

function formatReviewers(reviewers: string[]): string {
  return reviewers.join(', ');
}

function buildPushRef(branch: string, reviewers: string[]): string {
  if (reviewers.length === 0) {
    return `HEAD:refs/for/${branch}`;
  }
  const reviewerParams = reviewers.map((reviewer) => `r=${reviewer}`).join(',');
  return `HEAD:refs/for/${branch}%${reviewerParams}`;
}

async function promptReviewers(presets: string[]): Promise<string | undefined> {
  if (presets.length === 0) {
    return vscode.window.showInputBox({
      title: getText('reviewerInputTitle'),
      prompt: getText('reviewerInputPlaceholder'),
      placeHolder: getText('reviewerInputPlaceholder')
    });
  }

  type ReviewerPick = vscode.QuickPickItem & { value: string };
  const picks: ReviewerPick[] = [
    {
      label: getText('reviewerNoneLabel'),
      description: getText('reviewerNoneDescription'),
      value: '__none__'
    },
    ...presets.map((reviewer) => ({
      label: reviewer,
      description: getText('reviewerPresetDescription'),
      value: reviewer
    }))
  ];

  const qp = vscode.window.createQuickPick<ReviewerPick>();
  qp.title = getText('reviewerSelectTitle');
  qp.placeholder = getText('reviewerSelectPlaceholder');
  qp.items = picks;
  qp.canSelectMany = true;

  return await new Promise<string | undefined>((resolve) => {
    qp.onDidAccept(() => {
      const selected = qp.selectedItems.map((item) => item.value);
      const inputValue = qp.value.trim();
      const inputReviewers = inputValue.length > 0 ? normalizeReviewers(inputValue) : [];
      if (selected.includes('__none__')) {
        resolve('');
        qp.hide();
        return;
      }
      const combined = Array.from(new Set([...selected, ...inputReviewers]));
      resolve(combined.join(','));
      qp.hide();
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
}

async function runGit(args: string[], cwd: string, streamOutput = false): Promise<GitRunResult> {
  // 轻量封装 git 调用，可选择实时输出到 Output 窗口
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      if (streamOutput) {
        outputChannel.append(text);
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      if (streamOutput) {
        outputChannel.append(text);
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || `git exited with code ${code}`));
      }
    });
  });
}
