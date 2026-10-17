using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Web.Script.Serialization;

static class Program {
    public static string FindRoot() {
        var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        for (int i=0;i<7 && dir!=null;i++,dir=dir.Parent) if(File.Exists(Path.Combine(dir.FullName,"scripts","gui-controller.mjs"))) return dir.FullName;
        return null;
    }
    public static string FindNode() {
        var paths = new List<string>();
        foreach(var part in (Environment.GetEnvironmentVariable("PATH")??"").Split(';')) if(part.Length>0) paths.Add(Path.Combine(part.Trim('"'),"node.exe"));
        paths.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe"));
        paths.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".volta","bin","node.exe"));
        string nvm=Environment.GetEnvironmentVariable("NVM_HOME");
        if(!String.IsNullOrEmpty(nvm)&&Directory.Exists(nvm)) foreach(var dir in Directory.GetDirectories(nvm,"v*")) paths.Add(Path.Combine(dir,"node.exe"));
        foreach(var path in paths.Distinct()) if(File.Exists(path)) {
            try { using(var p=new Process()) { p.StartInfo=new ProcessStartInfo(path,"--version") {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};p.Start();
                if(!p.WaitForExit(2500)){p.Kill();continue;}var v=p.StandardOutput.ReadToEnd().Trim().TrimStart('v').Split('.');
                int major,minor;if(v.Length>=2&&Int32.TryParse(v[0],out major)&&Int32.TryParse(v[1],out minor)&&(major>22||major==22&&minor>=18)) return path;
            }} catch {}
        } return null;
    }
    public static string Quote(string s) {
        var b=new StringBuilder("\"");int slashes=0;
        foreach(char c in s){if(c=='\\'){slashes++;continue;}if(c=='\"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}
        b.Append('\\',slashes*2);b.Append('"');return b.ToString();
    }
    [STAThread] public static int Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        var root=FindRoot();
        if(args.Length>0&&args[0]=="--self-test") {var node=FindNode();var json=new JavaScriptSerializer().Serialize(new {platform="Windows",version=BuildInfo.Version,root=root??"",node=node??"",icon=System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath)!=null,start=new {action="start",port=3210,lan=false}});if(args.Length>1)File.WriteAllText(args[1],json,new UTF8Encoding(false));return root==null||node==null?1:0;}
        if(root==null) {using(var picker=new FolderBrowserDialog()){picker.Description="选择 My TV 项目文件夹";if(picker.ShowDialog()!=DialogResult.OK)return 0;root=picker.SelectedPath;}}
        Application.Run(new Launcher(root));return 0;
    }
}

sealed class Launcher : Form {
    readonly string root;
    readonly Label status=new Label(),address=new Label();
    readonly NumericUpDown port=new NumericUpDown();
    readonly CheckBox lan=new CheckBox();
    readonly Button start=new Button(),stop=new Button(),browse=new Button(),update=new Button();
    string version=BuildInfo.Version;const string ReleasesPage="https://github.com/AprilCaptain/mytv/releases/latest";
    readonly TextBox log=new TextBox();
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    Process bridge;StreamWriter input;bool quitting=false,allowQuit=false;
    static readonly Color Background=Color.FromArgb(18,23,18),TextColor=Color.FromArgb(228,235,222),Accent=Color.FromArgb(200,244,139);
    public Launcher(string project) {
        root=project;Icon=System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);Text="My TV";ClientSize=new Size(650,540);MinimumSize=new Size(610,520);StartPosition=FormStartPosition.CenterScreen;BackColor=Background;ForeColor=TextColor;Font=new Font("Segoe UI",10);
        var title=new Label {Text="▶  My TV",Font=new Font("Segoe UI",26,FontStyle.Bold),ForeColor=Accent,AutoSize=true,Location=new Point(24,20)};Controls.Add(title);
        Controls.Add(new Label {Text="启动服务，在浏览器中开始观影。",AutoSize=true,Location=new Point(25,76),ForeColor=Color.Silver});
        ConfigureButton(update,"检查更新 · v"+version,452,69,168);update.Height=29;update.Font=new Font("Segoe UI",9);update.Click+=delegate {if(bridge==null||bridge.HasExited){OpenRelease(ReleasesPage);return;}update.Enabled=false;update.Text="正在检查…";Send(new {action="update"});};
        status.Text="正在连接控制器…";status.SetBounds(25,112,595,28);status.Font=new Font("Segoe UI",12,FontStyle.Bold);Controls.Add(status);
        address.SetBounds(25,145,595,35);address.ForeColor=Color.Silver;Controls.Add(address);
        Controls.Add(new Label {Text="端口",AutoSize=true,Location=new Point(25,191)});
        port.Minimum=1;port.Maximum=65535;port.Value=3210;port.SetBounds(72,186,88,30);Controls.Add(port);
        lan.Text="允许局域网访问";lan.SetBounds(188,186,240,30);Controls.Add(lan);
        ConfigureButton(start,"启动服务",25,232,170);ConfigureButton(stop,"停止服务",212,232,170);ConfigureButton(browse,"打开观影网页",399,232,221);
        start.BackColor=Accent;start.ForeColor=Color.Black;start.Enabled=false;stop.Enabled=false;browse.Enabled=false;
        start.Click+=delegate { start.Enabled=false;Send(new {action="start",port=(int)port.Value,lan=lan.Checked}); };
        stop.Click+=delegate { stop.Enabled=false;Send(new {action="stop"}); };
        browse.Click+=delegate { try{Process.Start(new ProcessStartInfo("http://127.0.0.1:"+(int)port.Value){UseShellExecute=true});}catch(Exception e){Append(e.Message);} };
        Controls.Add(new Label {Text="运行详情",AutoSize=true,Location=new Point(25,289)});
        log.Multiline=true;log.ReadOnly=true;log.ScrollBars=ScrollBars.Vertical;log.BackColor=Color.FromArgb(25,31,24);log.ForeColor=TextColor;log.Font=new Font("Consolas",9);log.SetBounds(25,315,595,145);log.Anchor=AnchorStyles.Top|AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Bottom;Controls.Add(log);
        var footer=new Label {Text="关闭此窗口会停止服务并释放端口，观看记录会保留。",AutoSize=true,ForeColor=Color.Silver,Location=new Point(25,476),Anchor=AnchorStyles.Left|AnchorStyles.Bottom};Controls.Add(footer);
        Controls.Add(new Label {Text=root,AutoEllipsis=true,ForeColor=Color.Gray,Location=new Point(25,505),Size=new Size(595,22),Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Bottom});
        FormClosing+=ClosingWindow;Shown+=delegate {LaunchBridge();};
    }
    void ConfigureButton(Button b,string title,int x,int y,int width){b.Text=title;b.SetBounds(x,y,width,38);b.FlatStyle=FlatStyle.Flat;b.FlatAppearance.BorderColor=Color.FromArgb(70,82,61);b.BackColor=Color.FromArgb(35,43,31);b.ForeColor=TextColor;Controls.Add(b);}
    void OnUi(Action action){if(!IsDisposed&&IsHandleCreated)try{BeginInvoke(action);}catch{}}
    void Append(string text){log.AppendText(text+Environment.NewLine);if(log.TextLength>40000)log.Text=log.Text.Substring(log.TextLength-30000);log.SelectionStart=log.TextLength;log.ScrollToCaret();}
    void LaunchBridge(){
        System.Threading.ThreadPool.QueueUserWorkItem(delegate {
            var node=Program.FindNode();OnUi(delegate {
                if(node==null){status.Text="未找到兼容的 Node.js";start.Enabled=false;Append("请手动安装 Node.js 22.18 或更高版本（含 npm / 内置 SQLite），再重新打开启动器。\nhttps://nodejs.org/");return;}
                try {
                    bridge=new Process();bridge.StartInfo=new ProcessStartInfo(node,Program.Quote(Path.Combine(root,"scripts","gui-controller.mjs"))+" --root "+Program.Quote(root)) {WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=new UTF8Encoding(false),StandardErrorEncoding=new UTF8Encoding(false)};
                    bridge.StartInfo.EnvironmentVariables["PATH"]=Path.GetDirectoryName(node)+";"+(Environment.GetEnvironmentVariable("PATH")??"");
                    bridge.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)OnUi(delegate {Receive(e.Data);});};
                    bridge.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){if(e.Data!=null)OnUi(delegate {Append(e.Data);});};
                    bridge.EnableRaisingEvents=true;bridge.Exited+=delegate {OnUi(delegate {if(!allowQuit){status.Text="控制器已结束，请重新打开启动器";start.Enabled=false;}});};
                    bridge.Start();input=new StreamWriter(bridge.StandardInput.BaseStream,new UTF8Encoding(false));input.AutoFlush=true;bridge.BeginOutputReadLine();bridge.BeginErrorReadLine();
                }catch(Exception e){status.Text="无法启动控制器";Append(e.Message);}
            });
        });
    }
    string Value(Dictionary<string,object> v,string key){object x;return v.TryGetValue(key,out x)&&x!=null?x.ToString():"";}
    void Receive(string line){try{
        var value=json.Deserialize<Dictionary<string,object>>(line);var type=Value(value,"type");
        if(type=="state") {var phase=Value(value,"phase");bool busy=phase=="preparing"||phase=="starting"||phase=="stopping",running=phase=="running";
            status.Text=Value(value,"message");status.ForeColor=running?Accent:TextColor;int p;if(Int32.TryParse(Value(value,"port"),out p)&&p>=1&&p<=65535)port.Value=p;lan.Checked=Value(value,"lan").ToLowerInvariant()=="true";
            start.Enabled=!busy&&!running&&!quitting;stop.Enabled=(running||phase=="preparing"||phase=="starting")&&!quitting;browse.Enabled=running&&!quitting;port.Enabled=!busy&&!running&&!quitting;lan.Enabled=port.Enabled;
            address.Text=running?Value(value,"url"):"";object urls;if(running&&value.TryGetValue("addresses",out urls)&&urls is System.Collections.IEnumerable&&!(urls is string))foreach(var u in (System.Collections.IEnumerable)urls)address.Text+="   "+u;
        } else if(type=="meta"){version=Value(value,"version");update.Text="检查更新 · v"+version;}
        else if(type=="update"){update.Enabled=true;update.Text="检查更新 · v"+version;if(!quitting)ShowUpdate(value,null);}
        else if(type=="log")Append(Value(value,"message"));
        else if(type=="closed"){allowQuit=true;Close();}
        else if(type=="error"){Append(Value(value,"message"));if(Value(value,"action")=="update"){update.Enabled=true;update.Text="检查更新 · v"+version;if(!quitting)ShowUpdate(null,Value(value,"message"));}if(quitting){quitting=false;status.Text="停止未完成，请查看运行详情";stop.Enabled=true;}}
    }catch(Exception e){Append("控制信息无法读取："+e.Message);}}
    void OpenRelease(string url){try{Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}catch(Exception e){Append(e.Message);}}
    void ShowUpdate(Dictionary<string,object> value,string error){
        bool available=value!=null&&Value(value,"available").ToLowerInvariant()=="true";
        string notes=value==null?"":Value(value,"notes");if(notes.Length>1400)notes=notes.Substring(0,1400)+"\n完整说明请查看发布页。";
        string title=error!=null?"暂时无法检查更新":available?"发现新版本 v"+Value(value,"version"):"当前已是最新版本 · v"+version;
        string detail=error??(notes+"\n\n"+Value(value,"guide"));
        if(MessageBox.Show(this,detail+"\n\n是否打开版本发布页？",title,MessageBoxButtons.YesNo,MessageBoxIcon.Information)==DialogResult.Yes)OpenRelease(value==null?ReleasesPage:Value(value,"url"));
    }
    void Send(object value){try{if(input!=null)input.WriteLine(json.Serialize(value));}catch(Exception e){Append(e.Message);}}
    void ClosingWindow(object sender,FormClosingEventArgs e){if(allowQuit)return;if(bridge==null||bridge.HasExited)return;e.Cancel=true;if(quitting)return;quitting=true;status.Text="正在停止并释放端口…";start.Enabled=false;stop.Enabled=false;browse.Enabled=false;Send(new {action="quit"});}
}
