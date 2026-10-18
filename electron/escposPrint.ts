import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'

const execFileAsync = promisify(execFile)

/** ESC/POS: initialize, left align, text, feed, partial cut. */
export function buildEscPosReceipt(text: string): Buffer {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .trimEnd()

  // Thermal printers commonly expect a single-byte code page; keep printable Latin-1.
  const safe = normalized.replace(/[^\t\n\x20-\xFF]/g, '?')

  const parts: Buffer[] = [
    Buffer.from([0x1b, 0x40]), // ESC @ init
    Buffer.from([0x1b, 0x74, 0x00]), // ESC t 0 — PC437 / default code page
    Buffer.from([0x1b, 0x61, 0x00]), // ESC a 0 — left align
    Buffer.from([0x1b, 0x21, 0x00]), // ESC ! 0 — normal font
    Buffer.from(`${safe}\n\n\n`, 'latin1'),
    Buffer.from([0x1d, 0x56, 0x41, 0x03]), // GS V A n — partial cut
  ]
  return Buffer.concat(parts)
}

/**
 * Send RAW bytes to a Windows printer via winspool (bypasses Chromium GDI).
 * This is what POS-80-style printers expect for text receipts.
 */
export async function rawPrintWindows(
  printerName: string,
  data: Buffer,
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('RAW printing is only supported on Windows')
  }
  if (!printerName.trim()) {
    throw new Error('No printer name')
  }
  if (!data.length) {
    throw new Error('Empty print data')
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const binPath = path.join(app.getPath('temp'), `pos-raw-${id}.bin`)
  const psPath = path.join(app.getPath('temp'), `pos-raw-${id}.ps1`)

  const ps1 = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $FilePath)) { throw "Print file not found: $FilePath" }
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$signature = @"
using System;
using System.Runtime.InteropServices;
public class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Send(string printer, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter failed for " + printer);
    }
    var di = new DOCINFOA();
    di.pDocName = "Restaurant POS";
    di.pDataType = "RAW";
    if (StartDocPrinter(hPrinter, 1, di) == 0) {
      ClosePrinter(hPrinter);
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter failed");
    }
    if (!StartPagePrinter(hPrinter)) {
      EndDocPrinter(hPrinter);
      ClosePrinter(hPrinter);
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter failed");
    }
    IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
    int written;
    bool ok = WritePrinter(hPrinter, unmanaged, bytes.Length, out written);
    Marshal.FreeCoTaskMem(unmanaged);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    if (!ok) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter failed");
    }
  }
}
"@
Add-Type -TypeDefinition $signature -Language CSharp
[PosRawPrinter]::Send($PrinterName, $bytes)
Write-Output "OK"
`

  await fs.writeFile(binPath, data)
  await fs.writeFile(psPath, ps1, 'utf8')

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        psPath,
        '-PrinterName',
        printerName,
        '-FilePath',
        binPath,
      ],
      {
        windowsHide: true,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      },
    )
    const out = `${stdout || ''}\n${stderr || ''}`
    if (!/OK/i.test(out)) {
      throw new Error(out.trim() || 'RAW print did not confirm success')
    }
  } catch (err) {
    const e = err as Error & { stderr?: Buffer | string; stdout?: Buffer | string }
    const details = [e.stderr, e.stdout, e.message]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
      .join('\n')
    throw new Error(details || 'RAW print failed')
  } finally {
    void fs.unlink(binPath).catch(() => {})
    void fs.unlink(psPath).catch(() => {})
  }
}
