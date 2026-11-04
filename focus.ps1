# dsh-notice click bridge helper (ticket #6).
#
# Spawned (unref'ed) by the host half (index.js) when the human clicks a system
# notification. It brings the DSH Desktop main window back to the foreground:
#
#   1. Direct window path (primary): a posted WM_SYSCOMMAND / SC_RESTORE wakes a
#      tray-hidden, minimized or off-screen Chromium window; the window is then
#      raised with SetForegroundWindow, plus an AttachThreadInput workaround and one
#      more SC_RESTORE for Windows' foreground-lock policies. Measured on this
#      machine: the sandboxed host process runs below the Desktop window's integrity,
#      where a new Desktop instance starts but dies before the single-instance
#      handshake, so the protocol path below cannot wake the window -- but Windows
#      still delivers these taskbar-class messages to the higher-integrity window.
#   2. dsh://open fallback (the #3 baseline path): a second Desktop instance exits on
#      the single-instance lock and the primary calls focusPrimaryWindow(). Used only
#      when the window exists but the direct path could not raise it.
#
# Every failure is silent: this script is a side channel and must never disturb DSH.
# Keep this file pure ASCII: Windows PowerShell 5.1 decodes BOM-less script files as
# ANSI, so non-ASCII text here would be corrupted.
$ErrorActionPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DshNoticeFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint procId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

  public const uint WM_SYSCOMMAND = 0x0112;
  public const int SC_RESTORE = 0xF120;
  public const int RevealNotFound = 0;
  public const int RevealFocused = 1;
  public const int RevealFocusFailed = 2;

  /** DSH main window: Chromium host window whose title names the product (see docs/dev-loop.md). */
  public static IntPtr FindMainWindow() {
    IntPtr byTitleVisible = IntPtr.Zero;
    IntPtr byTitleAny = IntPtr.Zero;
    EnumWindows((h, l) => {
      var cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      var title = new StringBuilder(512);
      GetWindowText(h, title, 512);
      if (!title.ToString().Contains("DeepSeek Harness")) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      bool ownedByDsh;
      try { ownedByDsh = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName == "DeepSeek Harness"; }
      catch { ownedByDsh = true; } // restricted token: the title is the evidence
      if (!ownedByDsh) return true;
      if (IsWindowVisible(h)) { byTitleVisible = h; return false; }
      if (byTitleAny == IntPtr.Zero) byTitleAny = h;
      return true;
    }, IntPtr.Zero);
    return byTitleVisible != IntPtr.Zero ? byTitleVisible : byTitleAny;
  }

  /** "On screen" looks past IsWindowVisible: Chromium can keep WS_VISIBLE while parked off-screen. */
  public static bool OnScreen(IntPtr h) {
    if (h == IntPtr.Zero) return false;
    if (!IsWindowVisible(h)) return false;
    if (IsIconic(h)) return false;
    RECT r;
    if (!GetWindowRect(h, out r)) return false;
    if (r.Left < -10000 || r.Top < -10000) return false;
    return true;
  }

  public static bool FocusedNow() {
    var h = FindMainWindow();
    return h != IntPtr.Zero && GetForegroundWindow() == h;
  }

  static bool WaitFocused(IntPtr h, int attempts) {
    for (int i = 0; i < attempts && GetForegroundWindow() != h; i++) System.Threading.Thread.Sleep(20);
    return GetForegroundWindow() == h;
  }

  /** Raise a visible window; SetForegroundWindow alone is routinely refused by the foreground lock. */
  static bool TryForeground(IntPtr h) {
    if (GetForegroundWindow() == h) return true;
    SetForegroundWindow(h);
    if (WaitFocused(h, 10)) return true;

    // Foreground-lock workaround: attach to the current foreground thread, raise, detach.
    IntPtr foreground = GetForegroundWindow();
    uint unusedPid;
    uint foregroundThread = GetWindowThreadProcessId(foreground, out unusedPid);
    uint currentThread = GetCurrentThreadId();
    bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    try {
      BringWindowToTop(h);
      SetForegroundWindow(h);
      if (WaitFocused(h, 10)) return true;
    } finally {
      if (attached) AttachThreadInput(currentThread, foregroundThread, false);
    }

    // Last local resort: SC_RESTORE also activates the window through the shell path.
    PostMessage(h, WM_SYSCOMMAND, (IntPtr)SC_RESTORE, IntPtr.Zero);
    return WaitFocused(h, 10);
  }

  /**
   * Wake and raise the main window.
   * @returns 0 = window not found, 1 = focused, 2 = found but could not be raised.
   */
  public static int Reveal() {
    var h = FindMainWindow();
    if (h == IntPtr.Zero) return RevealNotFound;
    if (GetForegroundWindow() == h) return RevealFocused;
    if (!OnScreen(h)) {
      PostMessage(h, WM_SYSCOMMAND, (IntPtr)SC_RESTORE, IntPtr.Zero);
      for (int i = 0; i < 40 && !OnScreen(h); i++) System.Threading.Thread.Sleep(25);
    }
    return TryForeground(h) ? RevealFocused : RevealFocusFailed;
  }
}
'@

# 1) Direct window path (primary).
$state = [DshNoticeFocus]::Reveal()

# 2) Protocol fallback (#3 baseline) only when the window exists but could not be raised.
if ($state -eq [DshNoticeFocus]::RevealFocusFailed) {
  Start-Process 'dsh://open'
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 50
    if ([DshNoticeFocus]::FocusedNow()) { break }
  }
  [void][DshNoticeFocus]::Reveal()
}
