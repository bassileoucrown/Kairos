export default function VideoJoinLink({ room }) {
  if (!room) return null;
  const url = `https://meet.jit.si/${room}`;
  return (
    <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noreferrer">
      Join video call
    </a>
  );
}
