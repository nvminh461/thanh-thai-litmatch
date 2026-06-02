const LITMATCH_AVATAR_BASE_URL = "https://activity.static.ksztagent.com";

export function buildLitmatchAvatarUrl(avatarId: string | undefined | null) {
  const id = avatarId?.trim();

  if (!id) {
    return null;
  }

  if (/^https?:\/\//i.test(id)) {
    return id;
  }

  if (id.startsWith("/")) {
    return `${LITMATCH_AVATAR_BASE_URL}${id}`;
  }

  return `${LITMATCH_AVATAR_BASE_URL}/${id}`;
}
