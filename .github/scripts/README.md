# CI scripts

Run script tests from the repository root with the pinned Node version:

```sh
node --test .github/scripts/web-build-artifact.test.mjs
```

## Web build transfer

The web workflow builds once for its selected development or production target.
After the build, it seals the output, runs the remaining checks, verifies that
the output is unchanged and uploads a native GitHub artifact. Unit tests unset
the three target-specific `PUBLIC_*` values; build verification keeps them.

| Helper command | Responsibility |
| --- | --- |
| `configure` | Select the target from the event/ref/manual input and export its public build values |
| `prepare STAGE` | Copy the three build trees into an empty directory outside the checkout and emit the manifest hash |
| `verify-source STAGE` | Check the original seal against the checkout and build after CI checks |
| `restore STAGE` | Validate the downloaded manifest, context and files before replacing the owned build trees |

The artifact contains `apps/web/.svelte-kit/cloudflare`, `cloudflare-tmp` and
`output/server`, plus its manifest. The worker imports the sibling server and
manifest trees. Hidden files such as `.assetsignore` must survive transfer.
Deployment installs dependencies from the same frozen lockfile; dependencies
and unrelated generated output are outside the artifact.

The manifest binds the actual clean Git checkout, run, producer attempt, target,
public environment, configuration, tool versions and every file's bytes.
Consumers use the producer's immutable artifact ID and expected manifest hash.
The download action checks the outer artifact digest; the helper checks the
payload and rejects unsafe paths, links and unexpected files before restoration.

An eligible deployment builds locally only when web CI was legitimately skipped.
If a successful producer's artifact is missing, expired or invalid, deployment
stops. Rerun the producer instead of selecting another artifact or bypassing its
checks. A consumer rerun may use the original successful producer attempt.
