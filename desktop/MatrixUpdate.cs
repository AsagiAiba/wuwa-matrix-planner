using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

internal static class MatrixUpdate {
    const string Launcher = "终焉矩阵血线排布.exe";
    const string ManifestName = "release-manifest.json";
    const long MaxBytes = 1024L * 1024 * 1024;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    public class Item {
        public string path { get; set; }
        public long bytes { get; set; }
        public string sha256 { get; set; }
    }
    public class Manifest {
        public string name { get; set; }
        public string version { get; set; }
        public string platform { get; set; }
        public int fileCount { get; set; }
        public Item[] files { get; set; }
    }

    static int Main(string[] args) {
        try {
            if (args[0] == "prepare") {
                Console.OutputEncoding = new UTF8Encoding(false);
                Console.Write(Prepare(args[1], args[2], args[3]));
                return 0;
            }
            if (args[0] != "apply") throw new InvalidDataException("更新操作无效。");
            Apply(args);
            return 0;
        } catch (Exception e) {
            if (args.Length > 1 && args[0] == "apply") Log(args[1], e.ToString());
            else Console.Error.WriteLine(e.Message);
            return 1;
        }
    }
    static void Check(bool valid, string message) { if (!valid) throw new InvalidDataException(message); }
    static void Log(string work, string message) {
        File.AppendAllText(Path.Combine(work, "update.log"), DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
    }
    static string SafePath(string raw) {
        var name = raw.Replace('\\', '/');
        foreach (var part in name.Split('/')) {
            Check(part.Length > 0 && part.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 &&
                !part.EndsWith(".") && !part.EndsWith(" ") &&
                !Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(\.|$)", RegexOptions.IgnoreCase),
                "压缩包中有无效路径。");
        }
        return name;
    }
    static byte[] ManifestBytes(ZipArchiveEntry entry) {
        Check(entry.Length > 0 && entry.Length <= 4 * 1024 * 1024, "文件清单大小无效。");
        var data = new byte[(int)entry.Length];
        using (var s = entry.Open()) {
            int offset = 0, count;
            while (offset < data.Length && (count = s.Read(data, offset, data.Length - offset)) > 0) offset += count;
            Check(offset == data.Length && s.ReadByte() == -1, "文件清单损坏。");
        }
        return data;
    }
    static void DedicatedFolder(string root) {
        var old = Json.Deserialize<Manifest>(File.ReadAllText(Path.Combine(root, ManifestName)));
        var allowed = new HashSet<string>(old.files.Select(f => SafePath(f.path).Split('/')[0]), StringComparer.OrdinalIgnoreCase);
        allowed.Add(ManifestName);
        Check((File.GetAttributes(root) & FileAttributes.ReparsePoint) == 0, "请在普通便携文件夹中运行更新。");
        foreach (string name in Directory.GetFileSystemEntries(root))
            Check(allowed.Contains(Path.GetFileName(name)), "请将软件单独解压到一个文件夹，并把 ZIP 和其他文件放在该文件夹外。");
    }
    static string Prepare(string work, string root, string version) {
        DedicatedFolder(root);
        using (var zip = ZipFile.OpenRead(Path.Combine(work, "package.zip"))) {
            Check(zip.Entries.Count > 0 && zip.Entries.Count <= 20000, "ZIP 文件数量无效。");
            var entries = new Dictionary<string,ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
            string folder = null;
            foreach (var entry in zip.Entries) {
                var p = entry.FullName.Replace('\\','/');
                bool directory = p.EndsWith("/");
                p = SafePath(directory ? p.Substring(0,p.Length - 1) : p);
                var bits = p.Split(new char[] {'/'}, 2);
                if (folder == null) folder = bits[0];
                Check(folder == bits[0] && (directory || bits.Length == 2), "请选择完整的 Windows 便携包。");
                if (!directory) {
                    Check(!entries.ContainsKey(bits[1]), "ZIP 中存在重复路径。");
                    entries.Add(bits[1], entry);
                }
            }
            Check(entries.ContainsKey(ManifestName), "未找到便携版文件清单，请选择 win-x64.zip。");
            byte[] bytes = ManifestBytes(entries[ManifestName]);
            var manifest = Json.Deserialize<Manifest>(Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF'));
            Check(manifest != null && manifest.name == "终焉矩阵血线排布" && manifest.platform == "win-x64" &&
                manifest.version != null && Regex.IsMatch(manifest.version, @"^\d{1,6}\.\d{1,6}\.\d{1,6}$") &&
                folder == "WuwaMatrixPlanner-v" + manifest.version + "-win-x64", "包体名称、平台或版本无效。");
            Check(new Version(manifest.version) > new Version(version), "请选择比当前 v" + version + " 更新的版本。");
            entries.Remove(ManifestName);
            Check(manifest.files != null && manifest.fileCount == manifest.files.Length && entries.Count == manifest.fileCount &&
                new [] { Launcher, "runtime/node.exe", "server.mjs", "index.html", "app.js", "package.json" }.All(entries.ContainsKey), "更新包文件不完整。");
            string next = Path.Combine(work, "next");
            Directory.CreateDirectory(next);
            long total = 0;
            byte[] buffer = new byte[81920];
            foreach (var file in manifest.files) {
                string relative = SafePath(file.path);
                ZipArchiveEntry entry;
                Check(entries.TryGetValue(relative, out entry), "包体与文件清单不一致。");
                entries.Remove(relative);
                Check(file.bytes >= 0 && file.bytes <= MaxBytes - total && file.bytes == entry.Length, "文件大小校验失败。");
                total += file.bytes;
                var output = Path.Combine(next, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                using (var src = entry.Open())
                using (var dst = new FileStream(output, FileMode.CreateNew))
                using (var sha = SHA256.Create()) {
                    int count; long copied = 0;
                    while ((count = src.Read(buffer, 0, buffer.Length)) > 0) {
                        copied += count;
                        Check(copied <= file.bytes, "解压长度超过文件清单。");
                        dst.Write(buffer, 0, count);
                        sha.TransformBlock(buffer, 0, count, buffer, 0);
                    }
                    sha.TransformFinalBlock(buffer, 0, 0);
                    Check(copied == file.bytes && String.Equals(BitConverter.ToString(sha.Hash).Replace("-", ""), file.sha256, StringComparison.OrdinalIgnoreCase),
                        "文件校验失败：" + relative);
                }
            }
            var pkg = Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(next, "package.json")));
            Check((string)pkg["name"] == "wuwa-matrix-hp-planner" && (string)pkg["version"] == manifest.version &&
                FileVersionInfo.GetVersionInfo(Path.Combine(next, Launcher)).FileVersion == manifest.version + ".0", "程序与包体版本不一致。");
            File.WriteAllBytes(Path.Combine(next, ManifestName), bytes);
            return manifest.version;
        }
    }
    static void WaitForExit(int id) {
        try { using (var p = Process.GetProcessById(id)) Check(p.WaitForExit(20000), "原程序未退出。"); }
        catch (ArgumentException) { }
    }
    static void Move(string from, string to) {
        for (int i = 0; ; i++) {
            try { Directory.Move(from, to); return; }
            catch (IOException) { if (i == 19) throw; Thread.Sleep(250); }
        }
    }
    static Process Launch(string root, int port, bool headless) {
        return Process.Start(new ProcessStartInfo(Path.Combine(root, Launcher),
            (headless ? "--headless" : "--no-browser") + " --port " + port) {
            WorkingDirectory = root, UseShellExecute = false
        });
    }
    static bool Healthy(int port, string version, string root) {
        try {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/__matrix_health");
            req.Timeout = 500; req.Proxy = null;
            using (var response = req.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) {
                var data = Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
                return (string)data["app"] == "wuwa-matrix-hp-planner" && (string)data["version"] == version &&
                    String.Equals((string)data["root"], root, StringComparison.OrdinalIgnoreCase);
            }
        } catch { return false; }
    }
    static void Apply(string[] args) {
        string work = args[1], root = args[2], version = args[3];
        int port = int.Parse(args[4]);
        bool headless = args[7] == "1", oldMoved = false, nextMoved = false;
        string previous = Path.Combine(work, "previous");
        Process started = null;
        Log(work, "等待旧版释放文件。");
        File.WriteAllText(Path.Combine(work, "ready"), "ready");
        WaitForExit(int.Parse(args[5]));
        WaitForExit(int.Parse(args[6]));
        try {
            DedicatedFolder(root);
            Move(root, previous); oldMoved = true;
            Move(Path.Combine(work, "next"), root); nextMoved = true;
            started = Launch(root, port, headless);
            for (int i = 0; i < 80; i++) {
                if (Healthy(port, version, root)) { Log(work, "已启动 v" + version); return; }
                if (started.HasExited) break;
                Thread.Sleep(200);
            }
            throw new IOException("新版未能在原端口启动。");
        } catch (Exception error) {
            Log(work, error.Message);
            if (started != null && !started.HasExited) {
                using (var kill = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"),
                    "/PID " + started.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true })) kill.WaitForExit();
            }
            if (nextMoved) Move(root, Path.Combine(work, "failed"));
            if (oldMoved) Move(previous, root);
            Launch(root, port, headless).Dispose();
            Log(work, "已重新启动旧版。");
        } finally { if (started != null) started.Dispose(); }
    }
}
