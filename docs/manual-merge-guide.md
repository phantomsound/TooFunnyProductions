# Manual merge reference

When the automated `merge-pr-v2.ps1` helper cannot run (for example because the branch that fixes it has not been merged yet), start by verifying that your working tree is clean:

```powershell
git status
```

If only the files you intend to keep are staged or modified, you can merge a Codex branch into `main` manually with the following sequence:

```powershell
git fetch origin
git checkout main
git pull origin main
git merge --no-ff origin/<branch-name>
```

Replace `<branch-name>` with the remote branch you want, such as `codex/fix-migration-script-error-with-pg_net`. After running the merge, inspect the output:

* If Git reports `Automatic merge failed; fix conflicts and then commit the result.`, run `git status` to see the files in conflict.
* Open each conflicted file and decide whether to keep the incoming branch’s change, your local change, or a combination. The conflicting sections are delimited by `<<<<<<<`, `=======`, and `>>>>>>>` markers.
* For this repository, when you are pulling in an updated Codex branch you typically want to keep the new branch’s edits. In most editors you can choose “Accept Incoming Change” to grab the Codex version wholesale.
* After cleaning up the files and removing the conflict markers, run:

  ```powershell
  git add <each-fixed-file>
  git commit
  git push origin main
  ```

Once the merge commit is on `main`, you can optionally delete the feature branch with `git push origin --delete <branch-name>`.

Finally, rerun any local checks you rely on (for example `npm run doctor`) to ensure the repository still builds cleanly.
