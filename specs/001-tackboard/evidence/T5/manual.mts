import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, readlinkSync, lstatSync, readdirSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const SRC = process.env.SRC ?? "/Users/fiddlest/projects/tackboard-wt-a/packages/daemon/src/infrastructure/git_checkpoint_store.ts";
const { GitCheckpointStore } = await import(SRC);
const env = { ...process.env, GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@e",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@e" };
const g = (d:string,...a:string[]) => execFileSync("git",a,{cwd:d,env,encoding:"utf8"});
const w = (d:string,n:string,t:string|Buffer)=>{const f=join(d,n);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,t);};
const rd = (d:string,n:string)=>readFileSync(join(d,n),"utf8");
const repo = (commit=true)=>{const d=mkdtempSync(join(tmpdir(),"vrf-"));g(d,"init","-q","-b","main");w(d,".gitignore","ign.txt\nbuild/\n");w(d,"a.txt","a1\n");w(d,"b.txt","b1\n");if(commit){g(d,"add","-A");g(d,"commit","-q","-m","c");}return d;};
const tree = (d:string):string[] => { const out:string[]=[]; const walk=(p:string)=>{for(const e of readdirSync(join(d,p),{withFileTypes:true})){const r=p?p+"/"+e.name:e.name; if(r===".git")continue; if(e.isDirectory())walk(r); else out.push(r+(e.isSymbolicLink()?" -> "+readlinkSync(join(d,r)):"")+" ["+(e.isSymbolicLink()?"":readFileSync(join(d,r)).length)+"]");} out.push(p+"/") ;}; walk(""); return out.filter(x=>x!="/").sort(); };
let fails=0;
const check=(name:string,fn:()=>void)=>{try{fn();console.log("PASS",name);}catch(e){fails++;console.log("FAIL",name,"::",(e as Error).message.split("\n").slice(0,6).join(" | "));}};
const eq=(a:any,b:any,m="")=>{const x=JSON.stringify(a),y=JSON.stringify(b);if(x!==y)throw new Error(`${m} expected ${y} got ${x}`);};

check("full dirty round trip + safety snapshot round trip + older snapshot", ()=>{
  const d=repo(); const s=new GitCheckpointStore(d);
  g(d,"branch","other"); g(d,"stash","list");
  w(d,"a.txt","a-mod\n"); w(d,"new dir/ünï cödé 日本.txt","u\n"); w(d,"sub/x/deep.txt","d\n"); rmSync(join(d,"b.txt"));
  w(d,"ign.txt","ig\n"); w(d,"build/o.bin","o"); w(d,".tackboard/db","db");
  symlinkSync("a.txt",join(d,"link")); symlinkSync("nonexistent",join(d,"dangling"));
  w(d,"run.sh","#!/bin/sh\n"); chmodSync(join(d,"run.sh"),0o755);
  w(d,"big.bin",Buffer.alloc(60*1024*1024,7));
  const headB=g(d,"rev-parse","HEAD"), idxB=g(d,"ls-files","-s"), stB=g(d,"status","--porcelain"), brB=g(d,"branch","-a"), refsB=g(d,"for-each-ref");
  const one=s.snapshot("one");
  eq([g(d,"rev-parse","HEAD"),g(d,"ls-files","-s"),g(d,"status","--porcelain"),g(d,"branch","-a"),g(d,"stash","list")],[headB,idxB,stB,brB,""],"snapshot disturbed");
  const t1=tree(d);
  // later state
  w(d,"a.txt","a-later\n"); rmSync(join(d,"new dir"),{recursive:true}); w(d,"b.txt","bb\n"); w(d,"late/l.txt","l"); w(d,"sub/x/more.txt","m"); rmSync(join(d,"link")); symlinkSync("b.txt",join(d,"link")); rmSync(join(d,"big.bin")); w(d,"ign.txt","ig2\n"); w(d,".tackboard/db","db2");
  g(d,"add","late/l.txt");
  const two=s.snapshot("two"); const t2=tree(d);
  // safety snapshot then restore old
  const safety=s.snapshot("safety");
  s.restore(one);
  const t=tree(d).filter(x=>!x.startsWith("ign.txt")&&!x.startsWith(".tackboard")&&!x.startsWith("build"));
  eq(t,t1.filter(x=>!x.startsWith("ign.txt")&&!x.startsWith(".tackboard")&&!x.startsWith("build")),"restore one");
  eq(rd(d,"ign.txt"),"ig2\n","ignored"); eq(rd(d,".tackboard/db"),"db2","data"); eq(rd(d,"build/o.bin"),"o","build");
  eq(statSync(join(d,"run.sh")).mode&0o111,0o111,"exec bit"); eq(readlinkSync(join(d,"link")),"a.txt","symlink"); eq(readlinkSync(join(d,"dangling")),"nonexistent");
  eq(g(d,"diff","--cached","--name-only"),"","staged"); eq(g(d,"rev-parse","HEAD"),headB,"HEAD"); eq(g(d,"branch","-a"),brB,"branches");
  // restore back from safety
  s.restore(safety);
  eq(tree(d).filter(x=>!x.startsWith("ign.txt")&&!x.startsWith(".tackboard")),t2.filter(x=>!x.startsWith("ign.txt")&&!x.startsWith(".tackboard")),"safety back");
  eq(s.hasChangedSince(safety),false); 
  s.restore(two); eq(s.hasChangedSince(two),false);
  // refs unique, increasing
  const refs=g(d,"for-each-ref","--format=%(refname)","refs/tackboard/").trim().split("\n"); eq(refs.length,3);
  if(g(d,"log","-1","--format=%an <%ae>",one).trim()!=="checkpoint <checkpoint@localhost>") throw new Error("author");
  eq(g(d,"rev-list","--parents","-n1",one).trim(),one,"orphan");
});
check("empty dirs: pruned only if emptied by restore, pre-existing kept", ()=>{
  const d=repo(); const s=new GitCheckpointStore(d); const id=s.snapshot("s");
  mkdirSync(join(d,"preexisting-empty")); w(d,"p/q/r.txt","x"); mkdirSync(join(d,"keep/inner"),{recursive:true});
  s.restore(id);
  eq(existsSync(join(d,"p")),false,"p pruned"); eq(existsSync(join(d,"preexisting-empty")),true,"pre-empty kept"); eq(existsSync(join(d,"keep/inner")),true,"keep");
});
check("slash branch + detached + no commits", ()=>{
  const d=repo(); g(d,"checkout","-q","-b","feat/x/y"); const s=new GitCheckpointStore(d); const id=s.snapshot("s"); w(d,"a.txt","z"); s.restore(id); eq(rd(d,"a.txt"),"a1\n");
  g(d,"checkout","-q","--detach"); w(d,"a.txt","q"); const i2=s.snapshot("s"); w(d,"a.txt","z"); s.restore(i2); eq(rd(d,"a.txt"),"q");
  const e=repo(false); const s2=new GitCheckpointStore(e); const i3=s2.snapshot("s"); w(e,"zz","z"); rmSync(join(e,"a.txt")); s2.restore(i3); eq(existsSync(join(e,"zz")),false); eq(rd(e,"a.txt"),"a1\n"); eq(g(e,"status","--porcelain").includes("??"),true);
});
check("no git dir throws no_git", ()=>{ const d=mkdtempSync(join(tmpdir(),"vrf-")); const s=new GitCheckpointStore(d); w(d,"a","1"); for (const f of [()=>s.snapshot("x"),()=>s.restore("abc"),()=>s.hasChangedSince("abc")]) { try{f();throw new Error("nothrow");}catch(e:any){ if(e.code!=="no_git") throw new Error("code="+e.code+" "+e.message);} } });
check("tracked file that matches .gitignore (force-added) survives restore", ()=>{
  const d=repo(); w(d,"ign.txt","tracked-ignored\n"); g(d,"add","-f","ign.txt"); g(d,"commit","-q","-m","f");
  const s=new GitCheckpointStore(d); const id=s.snapshot("s"); w(d,"a.txt","zz"); s.restore(id); eq(existsSync(join(d,"ign.txt")),true,"ign.txt deleted!"); 
});
check("file<->directory swap", ()=>{
  const d=repo(); w(d,"thing","file\n"); const s=new GitCheckpointStore(d); const id=s.snapshot("s");
  rmSync(join(d,"thing")); w(d,"thing/inner.txt","i"); s.restore(id); eq(rd(d,"thing"),"file\n");
  const id2=s.snapshot("s2"); rmSync(join(d,"thing")); mkdirSync(join(d,"dd")); s.restore(id2);
});
check("dir->file swap (snapshot has dir, now file)", ()=>{
  const d=repo(); w(d,"thing/inner.txt","i\n"); const s=new GitCheckpointStore(d); const id=s.snapshot("s");
  rmSync(join(d,"thing"),{recursive:true}); w(d,"thing","file"); s.restore(id); eq(rd(d,"thing/inner.txt"),"i\n");
});
check("project dir is subfolder of a git repo", ()=>{
  const root=repo(); w(root,"top.txt","top\n"); w(root,"proj/p.txt","p1\n"); w(root,"proj/.tackboard/db","db"); g(root,"add","-A"); g(root,"commit","-q","-m","x");
  const dir=join(root,"proj"); const s=new GitCheckpointStore(dir);
  w(root,"proj/p.txt","p2\n"); w(root,"proj/n.txt","n\n"); const id=s.snapshot("s");
  w(root,"proj/p.txt","p3\n"); w(root,"proj/late.txt","l"); w(root,"top.txt","top-edited\n");
  s.restore(id);
  eq(rd(root,"proj/p.txt"),"p2\n"); eq(rd(root,"proj/n.txt"),"n\n"); eq(existsSync(join(root,"proj/late.txt")),false); eq(rd(root,"proj/.tackboard/db"),"db");
});
check("nested repo / submodule-like dir", ()=>{
  const d=repo(); const s=new GitCheckpointStore(d); w(d,"inner/f.txt","1"); g(join(d,"inner"),"init","-q"); const id=s.snapshot("s"); s.restore(id); eq(existsSync(join(d,"inner/f.txt")),true);
});
check("snapshot label starting with dash and weird chars", ()=>{ const d=repo(); const s=new GitCheckpointStore(d); const id=s.snapshot("--amend $(touch /tmp/pwn) `x`; \"q\""); if(existsSync("/tmp/pwn")) throw new Error("injection"); eq(g(d,"log","-1","--format=%s",id).trim(),"--amend $(touch /tmp/pwn) `x`; \"q\""); });
check("ref numbering = highest+1 after deletion of a middle/low ref", ()=>{
  const d=repo(); const s=new GitCheckpointStore(d); s.snapshot("1"); s.snapshot("2"); s.snapshot("3"); g(d,"update-ref","-d","refs/tackboard/3"); s.snapshot("4");
  eq(g(d,"for-each-ref","--format=%(refname)","refs/tackboard/").trim().split("\n"),["refs/tackboard/1","refs/tackboard/2","refs/tackboard/3"]);
});
check("changedFiles with deletion & unicode name; hasChangedSince after delete", ()=>{
  const d=repo(); w(d,"ü 日.txt","1"); const s=new GitCheckpointStore(d); const a=s.snapshot("a"); rmSync(join(d,"ü 日.txt")); rmSync(join(d,"a.txt")); const b=s.snapshot("b");
  eq(s.changedFiles(a,b).sort(),["a.txt","ü 日.txt"]); eq(s.hasChangedSince(a),true); eq(s.hasChangedSince(b),false);
  w(d,".tackboard/q","1"); eq(s.hasChangedSince(b),false,"data dir change"); w(d,"ign.txt","1"); eq(s.hasChangedSince(b),false,"ignored change");
});
console.log("FAILS",fails); process.exit(fails?1:0);
