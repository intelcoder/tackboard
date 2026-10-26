import subprocess, shutil, os, sys
B="base"; F="packages/daemon/src/infrastructure/git_checkpoint_store.ts"
src=open(f"{B}/{F}").read()
muts={
 "snapshot adds ignored files (add -A -f)": ('["add", "-A", "--", "."]','["add", "-A", "-f", "--", "."]'),
 "restore deletes ignored files": ('"--exclude-standard"','"--ignored", "--exclude-standard"'),
 "restore forgets deletions (no delete loop)": ('for (const path of to_delete) {','for (const path of []) {'),
 "data dir not excluded in snapshot": ('this.git(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", brand.dataDir], env);',''),
 "restore deletes data dir": ('&& p !== brand.dataDir && !p.startsWith(keep_prefix)',''),
 "ref numbering reuses ids (count-based)": ('biggest + 1}','names.filter(Boolean).length}'),
 "ref numbering always 1": ('biggest + 1}','1}'),
 "hasChangedSince always false": ('return this.current_tree() !== saved;','return false;'),
 "hasChangedSince always true": ('return this.current_tree() !== saved;','return true;'),
 "changedFiles misses deletes": ('"--name-only", "-z", from_id, to_id]','"--name-only", "--diff-filter=AM", "-z", from_id, to_id]'),
 "restore keeps staging (no reset)": ('if (this.has_head()) this.git(["reset", "-q"]);\n    else this.git(["read-tree", "--empty"]);',''),
 "snapshot uses real index (no temp index)": ('const env = { GIT_INDEX_FILE: index_file };\n      this.git(["add"','const env = {};\n      this.git(["add"'),
 "restore doesn't delete untracked": ('"--cached", "--others"','"--cached"'),
 "no_git swallowed": ('throw new DomainError("no_git", "this project is not a git repository");','throw new Error("x");'),
 "empty dirs never pruned": ('this.remove_empty_parents(dirname(full));',''),
 "empty dirs pruned aggressively (rm -r parent)": ('this.remove_empty_parents(dirname(full));','rmSync(dirname(full),{recursive:true,force:true});'),
}
for name,(a,b) in muts.items():
    if a not in src: print("NOMATCH",name); continue
    open(f"{B}/{F}","w").write(src.replace(a,b,1))
    r=subprocess.run(["node","--test","packages/daemon/test/git_checkpoint_store.test.ts"],cwd=B,capture_output=True,text=True)
    out=r.stdout
    fail=[l for l in out.splitlines() if l.startswith("not ok")]
    print(("CAUGHT " if r.returncode else "SURVIVED"),name,"|",len(fail),"failing")
open(f"{B}/{F}","w").write(src)
