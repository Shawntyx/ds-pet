import { exec } from 'child_process';

export interface ActiveWindowInfo {
  processName: string;
  title: string;
}

// 只读前台窗口的程序名和标题（SPEC 5.3："只读取当前活动窗口的程序名和标题...不截图、不读窗口内容"）。
// 用 PowerShell 调 user32.dll 的几个函数，不用装原生模块。参数用 -EncodedCommand（base64）传，
// 不用在 JS 字符串里手动转义一大段带引号的 PowerShell 代码。
//
// 头两行是必须的：PowerShell 往管道里输出时默认用本地代码页，而 Node 的 exec 按 UTF-8 解码，
// 中文标题会变成 "?"。把输出编码固定成 UTF-8 才对得上。
// 下面 CharSet.Unicode 同样是必须的：不写的话 GetWindowText 会绑定到 ANSI 版（GetWindowTextA），
// 在英文区域设置的 Windows 上（ANSI 代码页 1252）中文标题全变成 "?"——实测过一个中文标题只剩 "DS??"。
const PS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WhalePetWin32 {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$h = [WhalePetWin32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[WhalePetWin32]::GetWindowText($h, $sb, 512) | Out-Null
$procId = 0
[WhalePetWin32]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
$name = if ($proc) { $proc.ProcessName } else { "" }
Write-Output ($name + "|||" + $sb.ToString())
`.trim();

const ENCODED_COMMAND = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

// 不是真的"用户在用的程序"，锁屏/桌面这种就算标题非空也跳过，吐槽锁屏没意义。
const SKIP_PROCESS_NAMES = new Set(['LockApp', 'ShellExperienceHost', 'SearchHost']);

export function getActiveWindowInfo(): Promise<ActiveWindowInfo | null> {
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${ENCODED_COMMAND}`,
      // Add-Type 第一次要现场编译内联的 C# 代码，比普通 PowerShell 命令慢不少
      // （实测在这个沙盒里要 8 秒多，真实用户机器上应该快很多，但保险起见给够时间）。
      // 这个函数一次主动说话顶多调一次，不是高频路径，给够时间比抠超时时间更重要。
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const sep = stdout.indexOf('|||');
        if (sep < 0) {
          resolve(null);
          return;
        }
        const processName = stdout.slice(0, sep).trim();
        const title = stdout.slice(sep + 3).trim();
        if (!processName || SKIP_PROCESS_NAMES.has(processName)) {
          resolve(null);
          return;
        }
        resolve({ processName: `${processName}.exe`, title });
      }
    );
  });
}
