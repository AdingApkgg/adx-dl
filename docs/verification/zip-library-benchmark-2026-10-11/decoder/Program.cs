using Unity.SharpZipLib.Zip;
using System.Security.Cryptography;
using System.Text.Json;
var root = args[0];
using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(root,"fixture.json")));
var expected = new Dictionary<string,string>();
foreach(var chart in fixture.RootElement.EnumerateArray()) foreach(var file in chart.GetProperty("files").EnumerateArray()) expected.Add(chart.GetProperty("dir").GetString()+"/"+file.GetProperty("name").GetString(),file.GetProperty("sha256").GetString());
foreach(var path in Directory.GetFiles(root,"*.adx")) {
 using var archive = new ZipFile(File.OpenRead(path));int count=0;
 foreach(ZipEntry entry in archive) {var tail=entry.Name.Substring(entry.Name.IndexOf('/')+1);using var stream=archive.GetInputStream(entry);var hash=Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();if(hash!=expected[tail]) throw new Exception("Mismatch "+entry.Name);count++;}
 Console.WriteLine(JsonSerializer.Serialize(new {archive=Path.GetFileName(path),verifiedEntries=count,decoder="Unity.SharpZipLib 1.3.8 wrapper (SharpZipLib 1.3.3)",pass=true}));
}
