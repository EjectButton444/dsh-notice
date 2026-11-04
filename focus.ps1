# dsh-notice click bridge helper (ticket #6).
#
# Spawned (unref'ed) by the host half (index.js) when the human clicks a system
# notification, and asked to bring the DSH Desktop main window back to the foreground.
#
# Why this is not just "ShowWindow":
#   The renderer cannot wake the window itself (a tray-hidden window is unreachable
#   from the page and `dsh://` navigations are swallowed). The host half runs at a
#   lower integrity level than the Desktop window, so a `dsh://open` second instance
#   launched from it dies before Electron's single-instance handshake and cannot ask
#   the running instance to focus itself (spike #3 + docs/spikes/06-click-bridge.md).
#   A raw Win32 restore (posted WM_SYSCOMMAND / SC_RESTORE + ShowWindow) does bring the
#   HWND back on screen -- but Chromium's renderer stays frozen (no repaint, no
#   question card, clicks appear to do nothing) because Electron still considers the
#   window hidden. Measured directly in #6 verification (screen stays pixel-identical
#   for seconds).
#
# The fix: ask the app itself to show the window.
#   1. Primary path: post Electron's notify-icon callback message to the app's
#      `Electron_NotifyIconHostWindow`. That is Electron's own tray click event, so
#      DSH's tray handler runs `focusPrimaryWindow()` (restore + show + focus through
#      Electron's native path) and the window is fully interactive again. The contract
#      is Electron's, not a DSH private API: message WM_APP+1, first icon id 2
#      (kBaseIconId), click delivered with WM_LBUTTONDOWN as lParam.
#   2. Fallback: raw Win32 wake (posted SC_RESTORE, then ShowWindow, then
#      SetForegroundWindow with the AttachThreadInput foreground-lock workaround).
#      This restores the geometry even if the tray contract changes, but may leave the
#      renderer frozen until the user touches the tray icon / window state.
#   3. Last resort: `Start-Process 'dsh://open'` (the #3 baseline path) when the window
#      exists but the direct paths could not raise it.
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
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

  public const uint WM_SYSCOMMAND = 0x0112;
  public const int SC_RESTORE = 0xF120;
  public const int SW_SHOW = 5;
  public const int SW_RESTORE = 9;
  public const uint WM_LBUTTONDOWN = 0x0201;
  /** Electron's notify-icon callback message (WM_APP + 1). */
  public const uint TRAY_CLICK_MESSAGE = 0x8001;
  /** Electron's first tray icon id (kBaseIconId). */
  public const uint TRAY_ICON_ID = 2;

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

  /** The OS can keep a just-hidden window as GetForegroundWindow(); only a shown window counts. */
  public static bool FocusedNow() {
    var h = FindMainWindow();
    return h != IntPtr.Zero && OnScreen(h) && GetForegroundWindow() == h;
  }

  static bool WaitOnScreen(IntPtr h, int attempts) {
    for (int i = 0; i < attempts && !OnScreen(h); i++) System.Threading.Thread.Sleep(25);
    return OnScreen(h);
  }

  static bool WaitFocused(IntPtr h, int attempts) {
    for (int i = 0; i < attempts && GetForegroundWindow() != h; i++) System.Threading.Thread.Sleep(20);
    return GetForegroundWindow() == h;
  }

  /**
   * Primary path: run Electron's own tray-click event for the DSH process, which calls
   * the app's focusPrimaryWindow() (native restore + show + focus).
   * @returns false when the tray host window could not be found/posted to.
   */
  public static bool TryTrayClick() {
    var main = FindMainWindow();
    if (main == IntPtr.Zero) return false;
    uint targetPid;
    GetWindowThreadProcessId(main, out targetPid);
    IntPtr tray = IntPtr.Zero;
    EnumWindows((h, l) => {
      var cls = new StringBuilder(256);
      GetClassName(h, cls, 256);
      if (cls.ToString() != "Electron_NotifyIconHostWindow") return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != targetPid) return true;
      tray = h;
      return false;
    }, IntPtr.Zero);
    if (tray == IntPtr.Zero) return false;
    // Electron's notify_icon_host.cc dispatches a click on WM_LBUTTONDOWN for the icon
    // whose id equals wParam; ids for any other icons are ignored. Post the base icon id
    // and a few successors so an extra internal icon cannot mask the app's tray.
    for (uint iconId = TRAY_ICON_ID; iconId < TRAY_ICON_ID + 6; iconId++) {
      PostMessage(tray, TRAY_CLICK_MESSAGE, (IntPtr)iconId, (IntPtr)WM_LBUTTONDOWN);
    }
    return true;
  }

  /** Fallback: raw Win32 wake (works for the HWND, may leave the renderer unpainted). */
  static void Wake(IntPtr h) {
    PostMessage(h, WM_SYSCOMMAND, (IntPtr)SC_RESTORE, IntPtr.Zero);
    if (WaitOnScreen(h, 40)) return;
    ShowWindow(h, SW_RESTORE);
    if (WaitOnScreen(h, 40)) return;
    ShowWindow(h, SW_SHOW);
    WaitOnScreen(h, 40);
  }

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
    PostMessage(h, WM_SYSCOMMAND, (IntPtr)SC_RESTORE, IntPtr.Zero);
    return WaitFocused(h, 10);
  }

  /**
   * Wake and raise the main window.
   * @returns 0 = window not found, 1 = focused, 2 = found but could not be raised.
   */
  public static int Reveal() {
    var h = FindMainWindow();
    if (h == IntPtr.Zero) return 0;
    bool alreadyThere = OnScreen(h);
    if (alreadyThere && GetForegroundWindow() == h) return 1;
    if (!alreadyThere) Wake(h);
    if (!OnScreen(h)) return 2;
    return TryForeground(h) ? 1 : 2;
  }
}
'@

$state = -1
try {
  if ([DshNoticeFocus]::FocusedNow()) {
    $state = 1
  } else {
    # 1) Ask the app to show the window through its own tray-click path (native show,
    #    keeps the renderer alive).
    if ([DshNoticeFocus]::TryTrayClick()) {
      for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 50
        if ([DshNoticeFocus]::FocusedNow()) { break }
      }
      if ([DshNoticeFocus]::FocusedNow()) { $state = 1 }
    }
    # 2) Raw Win32 wake/focus fallback.
    if ($state -ne 1) { $state = [DshNoticeFocus]::Reveal() }
  }
} catch {
  $state = -1
}

# 3) Protocol fallback (#3 baseline) only when the window exists but could not be raised.
if ($state -eq 2) {
  Start-Process 'dsh://open'
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 50
    try { if ([DshNoticeFocus]::FocusedNow()) { break } } catch { }
  }
  try { [void][DshNoticeFocus]::Reveal() } catch { }
}
