// A file sent during a remote session: a download link while the file is kept (30 days) and its SHA-256.
export function SessionFileLinks({ fileId, download, sha256, inline = false }) {
  if (!fileId) return null;
  const links = (
    <>
      {download ? (
        <a href={`/session-files/${fileId}`} target="_blank" rel="noopener noreferrer" title="Files are kept for 30 days">Download</a>
      ) : null}
      {sha256 ? <span className="session-file-hash" title={`SHA-256 ${sha256}`}>SHA-256 {sha256.slice(0, 12)}…</span> : null}
    </>
  );
  if (inline) return links;
  return <p className="timeline-body session-file-links">{links}</p>;
}
