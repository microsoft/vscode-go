## Continuous Integration Testing

Currently we are using two separate CI systems to test all changes and pushed commits:
Tests running in Google Cloud Build (GCB) and tests running with GitHub Action.
It is a temporary setup; once GCB fully supports our desired workflow that works
with the Go Git repository, we plan to use the GCB-based setup for CI.

### Testing via GCB

This workflow is triggered for Gerrit CLs (chosen by project members) and all
the commits merged into the master branch.
Note that our main repository is in `go.googlesource.com/vscode-go` and
`github.com/golang/vscode-go` is a mirror of the Go Git repository.
All PRs sent to `github.com/golang/vscode-go` will be converted as Gerrit CLs.
Currently, the results of the CI Run are visible to only project members.
We are working on improving this workflow - making the results visible to
public and easily accessible through our Gerrit review UI.

- `build/cloudbuild.yaml`, `build/all.bash` - define the GCB workflow.
- `build/cloudbuild.container.yaml`, `build/Dockerfile` - define the Docker container used for CI.

Project members (currently restricted to our GCP project members) can manually
trigger cloud build and test their locally made changes. 
Follow the [GCB instruction](https://cloud.google.com/cloud-build/docs/running-builds/start-build-manually)
to set up the environment and tools, and then run

```
$ gcloud builds submit --config=build/cloudbuild.yaml
```

In order to modify and rebuild the docker container image, run

```
$ gcloud builds submit --config=build/cloudbuild.container.yaml
```

### Testing via GitHub Action

This is the workflow triggered for every PR and commit made to our mirror repository in github.com/golang/vscode-go. We are using this CI to run tests
in the platforms which GCB does not support yet, and allow contributors 
to see the test results for their PRs. This workflow is not triggered by
CLs sent via Gerrit yet.

Until GCB-based CI is ready for general use, we recommend contributors
to send PRs to github.com/golang/vscode-go as described in
[the Go project contribution guide](https://golang.org/doc/contribute.html#sending_a_change_github). The results will be posted to the PR request.

- `.github/workflows/ci.yml` - define the github action based CI workflow.

## Nightly Release

A new version is released based on what is committed on the `master` branch,
at least once a day between Monday and Thursday. If there is no new commit,
release does not happen. This nightly extension is a separate extension from
the official Go extension, and is available at [the VS Code market place](https://marketplace.visualstudio.com/items?itemName=golang.go-nightly).

The version number encodes the last commit timestamp of the master branch
in the format of `YYYY.[M]M.[D]DHH`. For example, version 2020.3.702 indicates
the extension is built with the last commit committed at ~2AM 2020/03/07 (UTC).

- `.github/workflows/release.yml, build/all.bash` - define the daily release process.

## Sync with upstream

### Merging commits from upstream

This is done manually by project members, probably before each nightly release.

Once we consolidate the two repositories, this process becomes unnecessary.

The merge script will create a Gerrit CL for merge and issue the GCB based test workflow. 
The remote `origin` should be set to `https://go.googlesource.com/vscode-go`.
Make sure you have access to the GCB project and `gcloud` tool 
is available.

```
$ build/merge.sh
```

In case of conflicts, you will need to check out the cl, fix, and upload the
updated cl again following the usual Gerrit CL workflow.

### Reflecting commits to upstream

Once the feature or bug fix tested with Nightly extension is stablized, create
a PR to the upstream (github.com/microsoft/vscode-go).
Please make sure to include all the gerrit CL numbers so the upstream code
reviewers can find reference to all prior discussion.
