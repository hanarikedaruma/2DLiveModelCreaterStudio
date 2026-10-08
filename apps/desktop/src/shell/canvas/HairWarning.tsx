import './hairWarning.css';
export function HairWarning({ message }: { message: string }) {
  return message ? (
    <div className="hair-frame-warning" role="status">
      {message}
    </div>
  ) : null;
}
