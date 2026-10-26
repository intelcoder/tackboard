import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os"; import { join, dirname } from "node:path";
const { GitCheckpointStore } = await import("/Users/fiddlest/projects/tackboard-wt-a/packages/daemon/src/infrastructure/git_checkpoint_store.ts");
const env = { ...process.env, GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@e",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@e" };
const g=(d:string,...a:string[])=>execFileSync("git",a,{cwd:d,env,encoding:"utf8"});
const w=(d:string,n:string,t:string)=>{const f=join(d,n);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,t);};
const mk=()=>{const d=mkdtempSync(join(tmpdir(),"vrf-"));g(d,"init","-q","-b","main");w(d,"a.txt","a");g(d,"add","-A");g(d,"commit","-q","-m","c");return d;};
for (const [name,setup,mutate] of [
 ["A: snap=file, now=dir with files",(d:string)=>w(d,"thing","F"),(d:string)=>{rmSync(join(d,"thing"));w(d,"thing/inner.txt","i");}],
 ["B: snap=dir, now=file",(d:string)=>w(d,"thing/inner.txt","I"),(d:string)=>{rmSync(join(d,"thing"),{recursive:true});w(d,"thing","F");}],
 ["C: snap=file, now=empty dir",(d:string)=>w(d,"thing","F"),(d:string)=>{rmSync(join(d,"thing"));mkdirSync(join(d,"thing"));}],
] as const) {
  const d=mk(); setup(d); const s=new GitCheckpointStore(d); const id=s.snapshot("s"); mutate(d);
  try { s.restore(id); console.log(name,"OK", readdirSync(d)); } catch(e){ console.log(name,"THROWS:",(e as Error).message.split("\n")[0], "| after:", readdirSync(d)); }
}
