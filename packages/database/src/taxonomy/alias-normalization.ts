const taxonomySeparatorPattern = /[\s.'’_-]+/gu;

function hasUnsafeTaxonomyCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

export function normalizeTaxonomyAlias(value: string): string {
  if (hasUnsafeTaxonomyCharacter(value)) return "";
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(taxonomySeparatorPattern, "");
}
