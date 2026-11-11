/** 规范化下载排除规则；路径以选中的结果目录为根，不接受正则或模板语法。 */
export function normalizeResultExcludes(values: string[] = []): string[] {
  if (values.length > 200) throw new Error('拉取排除规则最多 200 条');
  const patterns = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  for (const pattern of patterns) {
    if (pattern.length > 2000 || pattern.startsWith('/') || /[\\:{}\u0000-\u001f\u007f-\u009f]/.test(pattern)
      || pattern.replace(/\/$/, '').split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('拉取排除规则不正确：' + pattern);
    }
  }
  return patterns;
}

/** 仅编译 *、**、? 三种通配符，其他正则字符均按文件名处理。 */
export function resultDownloadFilter(patterns: string[]): (relativePath: string, isDirectory: boolean) => boolean {
  const compiled = normalizeResultExcludes(patterns).map((pattern) => {
    const segments = pattern.replace(/\/$/, '').split('/');
    let expression = '^';
    segments.forEach((segment, index) => {
      if (segment === '**') {
        expression += index === segments.length - 1 ? '.*' : '(?:[^/]+/)*';
      } else {
        expression += Array.from(segment, (character) => character === '*' ? '[^/]*'
          : character === '?' ? '[^/]' : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
        if (index < segments.length - 1) expression += '/';
      }
    });
    if (expression.endsWith('/.*')) expression = expression.slice(0, -3) + '(?:/.*)?';
    return { pattern: new RegExp(expression + '$', 'u'), directoryOnly: pattern.endsWith('/') };
  });
  return (relativePath, isDirectory) => compiled.some(({ pattern, directoryOnly }) =>
    (!directoryOnly || isDirectory) && pattern.test(relativePath));
}
