import * as vscode from 'vscode';
import { spawn } from 'child_process';

type GitRunResult = {
  stdout: string;
  stderr: string;
};

type BranchPick = vscode.QuickPickItem & { value: string };
type RemotePick = vscode.QuickPickItem & { value: string };

// 输出 Gerrit push 相关日志
const outputChannel = vscode.window.createOutputChannel('Gerrit Push');

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('gerritPush.pushToGerrit', async (sourceControl?: any) => {
    try {
      await pushToGerrit(sourceControl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`Error: ${message}`);
      vscode.window.showErrorMessage(`Gerrit push failed: ${message}`);
    }
  });

  context.subscriptions.push(disposable, outputChannel);
}

export function deactivate() {
  // Nothing to clean up
}

async function pushToGerrit(sourceControl?: any) {
  // 首先尝试从源控制上下文获取仓库（用户从 SCM 面板点击按钮时）
  let gitRoot: string | undefined;
  
  if (sourceControl?.rootUri?.fsPath) {
    // SCM 面板按钮点击时，sourceControl 包含 rootUri 信息
    gitRoot = sourceControl.rootUri.fsPath;
    outputChannel.appendLine(`Using repository from SCM context: ${gitRoot}`);
  } else {
    // 降级方案：从活跃编辑器或第一个 workspace folder 推导仓库路径
    const activeEditor = vscode.window.activeTextEditor;
    let cwd = activeEditor?.document.uri.fsPath
      ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    if (cwd) {
      gitRoot = await resolveGitRoot(cwd);
    }
  }

  if (!gitRoot) {
    vscode.window.showErrorMessage('未找到可用的 Git 仓库，请切换到包含 .git 的目录后重试。');
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

  const pushRef = `HEAD:refs/for/${branch}`;
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
  outputChannel.appendLine('═══════════════════════════════════════');
  outputChannel.appendLine('');

  // 显式确认，避免误推
  if (confirmBeforePush) {
    const confirmed = await showPushConfirmation(branch, remote, remoteUrl, confirmationStyle, compactRemoteUrl);
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
  const picks: BranchPick[] = [
    {
      label: `$(git-branch) ${currentBranch}`,
      description: 'Use current branch',
      value: currentBranch
    }
  ];

  if (defaultBranch && defaultBranch !== currentBranch) {
    picks.push({
      label: `$(rocket) ${defaultBranch}`,
      description: 'Use configured default branch',
      value: defaultBranch
    });
  }

  // 获取远程分支列表
  const remoteBranches = await listRemoteBranches(remote, cwd);
  for (const branch of remoteBranches) {
    // 避免重复添加已有的分支
    if (branch !== currentBranch && branch !== defaultBranch) {
      picks.push({
        label: `$(cloud) ${branch}`,
        description: `Remote branch: ${remote}/${branch}`,
        value: branch
      });
    }
  }

  // 用自定义 QuickPick，允许直接输入分支名后回车
  const qp = vscode.window.createQuickPick<BranchPick>();
  qp.title = '选择或输入目标分支 (refs/for/<branch>)';
  qp.placeholder = '输入分支/引用，或选择下方推荐项';
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
    vscode.window.showErrorMessage('No git remotes found for Gerrit push.');
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
    placeHolder: 'Select remote to push to Gerrit'
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
  style: 'quickpick' | 'message',
  compactUrl: boolean
): Promise<boolean> {
  if (style === 'message') {
    return showMessageConfirmation(branch, remote, remoteUrl, compactUrl);
  } else {
    return showQuickPickConfirmation(branch, remote, remoteUrl, compactUrl);
  }
}

async function showQuickPickConfirmation(
  branch: string,
  remote: string,
  remoteUrl: string | undefined,
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
  qp.title = 'Confirm Gerrit Push';
  qp.items = picks;
  qp.placeholder = 'Select to confirm or cancel';

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
  compactUrl: boolean
): Promise<boolean> {
  const displayUrl = remoteUrl ? (compactUrl ? extractRepoName(remoteUrl) : remoteUrl) : '';
  const confirmMessage = displayUrl
    ? `Push to:\n  Branch: ${branch}\n  Remote: ${remote}\n  Repo: ${displayUrl}`
    : `Push to:\n  Branch: ${branch}\n  Remote: ${remote}`;
  
  const confirm = await vscode.window.showWarningMessage(
    confirmMessage,
    { modal: true },
    'Push'
  );
  return confirm === 'Push';
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
