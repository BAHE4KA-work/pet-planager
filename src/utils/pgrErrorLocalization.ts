export function localizePgrParseError(message: string, locale: 'ru' | 'en'): string {
  if (locale === 'ru') return message;
  const sourcePrefix = message.match(/^(.*:\s*)(PGR block \d+:.*)$/u);
  if (sourcePrefix) return `${sourcePrefix[1]}${localizePgrParseError(sourcePrefix[2], locale)}`;
  const block = message.match(/^PGR block (\d+): (.*)$/u);
  if (!block) return message;

  const detail = block[2];
  const translations: [RegExp, string][] = [
    [/^неверный заголовок элемента$/iu, 'invalid element header'],
    [/^неподдерживаемый тип "(.+)"$/iu, 'unsupported element type "$1"'],
    [/^пустой заголовок$/iu, 'empty element title'],
    [/^повторяющееся поле заголовка "(.+)"$/iu, 'duplicate header field "$1"'],
    [/^поле заголовка "(.+)" не поддерживается для типа (.+)$/iu, 'header field "$1" is not supported for type $2'],
    [/^неподдерживаемый status "(.+)"$/iu, 'unsupported status "$1"'],
    [/^неверное значение mvp "(.+)" \(ожидается да\/нет\)$/iu, 'invalid MVP value "$1" (expected yes/no)'],
    [/^неизвестное поле заголовка "(.+)"$/iu, 'unknown header field "$1"'],
    [/^отсутствует или неверный ID для типа (.+)$/iu, 'missing or invalid ID for type $1'],
    [/^дублирующийся ID (.+)$/iu, 'duplicate ID $1'],
  ];
  const matchedTranslation = translations.find(([pattern]) => pattern.test(detail));
  const localizedDetail = matchedTranslation
    ? detail.replace(matchedTranslation[0], matchedTranslation[1])
    : 'invalid PGR syntax';
  return `PGR block ${block[1]}: ${localizedDetail}`;
}
