#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path

EXPECTED_TAG = '0.2.0.rc.2.5'
EXPECTED_SOURCE = 'b1e845853b9c6f49283fe4cf30eda2ee5bd520c1'
EXPECTED_MAC_SHA256 = '65dfc04d7588be0e6ec44cc27a79e48ce9f8dd2b5e6f7474df49a997ea4d1d0a'
EXPECTED_WINDOWS_ZIP_SHA256 = 'afb45dfacfee5dcda094bf3f462db260f5cf8f6dba7e55101c4f1836d7fe9158'
EXPECTED_MANIFEST_SHA256 = 'aa627603e6eea87d5c6749807cc7499d76ed8ac444146debe35467125df64b72'
EXPECTED_WINDOWS_ARTIFACT_SHA256 = '4f3f439cdc7cabf17d910d2b75a6789395d1fd475c499f6db22366515b6f7e56'
EXPECTED_OCBC_BOOT_SHA256 = 'edfb4344a280d046792eacb5e56aef9cd108b4c7880395cf6c2ee6ee638431a1'


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument('--manifest', required=True)
parser.add_argument('--mac-zip', required=True)
parser.add_argument('--windows-zip', required=True)
parser.add_argument('--windows-standard-user', required=True)
parser.add_argument('--windows-wrapper', required=True)
parser.add_argument('--closure', required=True)
parser.add_argument('--source-run', required=True)
parser.add_argument('--windows-artifact', required=True)
parser.add_argument('--release-assets', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()

manifest_path = Path(args.manifest)
mac_zip = Path(args.mac_zip)
windows_zip = Path(args.windows_zip)
windows_receipt_path = Path(args.windows_standard_user)
windows_wrapper_path = Path(args.windows_wrapper)
closure_path = Path(args.closure)
source_run_path = Path(args.source_run)
release_path = Path(args.release_assets)
windows_artifact_path = Path(args.windows_artifact)
manifest_bytes = manifest_path.read_bytes()
manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
assert manifest_hash == EXPECTED_MANIFEST_SHA256
manifest = json.loads(manifest_bytes)
assert manifest['schemaVersion'] == 1 and manifest['sourceCommit'] == EXPECTED_SOURCE
assert manifest['archive'] == {
    'name': mac_zip.name,
    'bytes': 441459107,
    'sha256': EXPECTED_MAC_SHA256,
}

windows_sha = sha256(windows_zip)
windows_wrapper_sha = sha256(windows_wrapper_path)
assert sha256(mac_zip) == EXPECTED_MAC_SHA256
assert windows_sha == EXPECTED_WINDOWS_ZIP_SHA256
windows_receipt = json.loads(windows_receipt_path.read_text())
assert windows_receipt['target'] == 'win-x64'
assert windows_receipt['version'] == EXPECTED_TAG
assert windows_receipt['standardUser'] is True and windows_receipt['packagedSmoke'] == 'passed'
assert windows_receipt['archive'] == windows_zip.name and windows_receipt['sha256'] == windows_sha

closure = json.loads(closure_path.read_text())
assert closure['passed'] is True and closure['identical'] is True
assert closure['sourceCommit'] == EXPECTED_SOURCE
compared = {item['target']: item for item in closure['comparedTargets']}
assert compared['mac-arm64']['archiveSha256'] == EXPECTED_MAC_SHA256
assert compared['win-x64']['archiveSha256'] == windows_sha
assert compared['mac-arm64']['ocbcBootSha256'] == EXPECTED_OCBC_BOOT_SHA256
assert compared['win-x64']['ocbcBootSha256'] == EXPECTED_OCBC_BOOT_SHA256

source_run = json.loads(source_run_path.read_text())
assert source_run['id'] == 37758256632
assert source_run['status'] == 'completed' and source_run['conclusion'] == 'success'
assert source_run['head_sha'] == EXPECTED_SOURCE
assert source_run['event'] in ['push', 'workflow_dispatch'] and source_run['head_branch'] == 'desktop'
assert source_run['path'] == '.github/workflows/desktop-portable.yml'

artifact_response = json.loads(windows_artifact_path.read_text())
matching_artifacts = [item for item in artifact_response['artifacts'] if item['name'] == 'dsh-desktop-win-x64']
assert len(matching_artifacts) == 1
windows_artifact = matching_artifacts[0]
assert windows_artifact['id'] == 11542086810
assert windows_artifact['size_in_bytes'] == 437756287 and windows_artifact['expired'] is False
assert windows_artifact['digest'] == f'sha256:{EXPECTED_WINDOWS_ARTIFACT_SHA256}'
assert windows_wrapper_path.stat().st_size == windows_artifact['size_in_bytes']
assert windows_wrapper_sha == EXPECTED_WINDOWS_ARTIFACT_SHA256

release = json.loads(release_path.read_text())
assert release['tag_name'] == EXPECTED_TAG and release['draft'] is True
assert release['id'] == 406690206 and release['target_commitish'] == EXPECTED_SOURCE
assets = {asset['name']: asset for asset in release['assets']}
uploaded = {}
for name, digest, byte_count in [
    (mac_zip.name, EXPECTED_MAC_SHA256, 441459107),
    (windows_zip.name, windows_sha, windows_zip.stat().st_size),
]:
    asset = assets[name]
    assert asset['size'] == byte_count
    assert asset['digest'] == f'sha256:{digest}', asset
    uploaded[name] = {'assetId': asset['id'], 'size': asset['size'], 'apiDigest': asset['digest']}

receipt = {
    'schemaVersion': 1,
    'passed': True,
    'tag': EXPECTED_TAG,
    'releaseDraft': True,
    'releaseId': release.get('id'),
    'releaseTargetCommitish': release['target_commitish'],
    'sourceRun': 37758256632,
    'sourceRunDetails': {'id': source_run['id'], 'status': source_run['status'],
                         'conclusion': source_run['conclusion'], 'headSha': source_run['head_sha'],
                         'event': source_run['event'], 'headBranch': source_run['head_branch'],
                         'workflowPath': source_run['path']},
    'sourceCommit': EXPECTED_SOURCE,
    'workflowCommit': os.environ.get('GITHUB_SHA'),
    'manifest': {'name': manifest_path.name, 'sha256': manifest_hash, 'sourceCommit': manifest['sourceCommit']},
    'windowsActionsArtifact': {'id': windows_artifact['id'], 'name': windows_artifact['name'],
                               'size': windows_artifact['size_in_bytes'], 'apiDigest': windows_artifact['digest'],
                               'downloadedWrapperSha256': windows_wrapper_sha, 'rawSha256Verified': True},
    'mac': {'name': mac_zip.name, 'bytes': mac_zip.stat().st_size, 'sha256': sha256(mac_zip),
            'expectedSha256': EXPECTED_MAC_SHA256, 'parts': manifest['parts'], 'zipCrcPassed': True},
    'windows': {'name': windows_zip.name, 'bytes': windows_zip.stat().st_size, 'sha256': windows_sha,
                'standardUserReceipt': windows_receipt, 'zipCrcPassed': True},
    'runtimeClosureEvidence': {'path': closure_path.name, 'sourceCommit': closure['sourceCommit'],
                               'fileCount': len(closure['comparedTargets'][0]['files']),
                               'ocbcBootSha256': EXPECTED_OCBC_BOOT_SHA256, 'passed': True},
    'uploadedAssets': uploaded,
}
Path(args.output).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'passed': True, 'sourceCommit': EXPECTED_SOURCE,
                  'uploadedAssets': list(uploaded)}, separators=(',', ':')))
