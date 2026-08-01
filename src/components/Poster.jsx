export default function Poster({ id, radius = 22, style }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        backgroundImage: `url(https://picsum.photos/seed/${id}/500/750)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        ...style,
      }}
    />
  );
}

export function Avatar({ id, size = 64, radius = 16 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundImage: `url(https://picsum.photos/seed/${id}/200/200)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        flex: 'none',
      }}
    />
  );
}
