# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import os
import urllib.error
import urllib.request

# Base URL works both ways: localhost when rehearsing unsandboxed,
# host.docker.internal injected by the sandbox launch wrapper.
_APP_URL = os.environ.get("APP_URL", "http://127.0.0.1:3000")


def rollback_deployment(version: str, pool_size: int) -> dict:
    """Roll back the driftwood-inventory service to a previous version.

    This redeploys the service with the given version and connection pool
    size. Use only after the investigation has identified a bad deployment
    and the operator has approved the rollback.

    Args:
        version: The version to roll back to (e.g. "1.3.2").
        pool_size: The connection pool size for that version (e.g. 50).

    Returns:
        The deployment endpoint's response, or an error description.
    """
    req = urllib.request.Request(
        f"{_APP_URL}/admin/deploy",
        data=json.dumps({"version": version, "poolSize": pool_size}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return {"status": res.status, "body": json.loads(res.read().decode())}
    except urllib.error.URLError as err:
        # Surface the failure to the model — inside the sandbox a refused
        # connection is itself demo material, never a crash.
        return {"status": "error", "detail": str(err)}
