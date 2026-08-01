export function toUserResponse(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    genres: row.genres,
    language: row.language,
    regions: row.regions,
    role: row.role,
  };
}
