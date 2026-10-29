# Security

Report vulnerabilities privately to **info@sarginlabs.com**, with `Sidewave security` in the subject. Do not include real credentials, listening histories or user database dumps. Include the affected revision, a minimal reproduction and the expected boundary.

This initial release is maintained on a best-effort basis. There is no guaranteed response or patch timeline.

Use HTTPS when exposing an installation outside your trusted LAN. Create the first owner account before exposing registration. The resolver is an internal service and its port should remain unpublished.

Android release keys belong to the instance/build owner. Keep keys and signing properties outside the repository. The Android client verifies an update against its installed signing identity; server metadata alone is insufficient.
