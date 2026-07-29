const RULES = [
  {
    code: "out-of-memory",
    pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    severity: "error",
    title: "Minecraft не хватило памяти",
    message:
      "Увеличьте память инстанса на 2–4 ГБ или отключите тяжёлые моды и ресурспаки.",
  },
  {
    code: "wrong-java",
    pattern:
      /UnsupportedClassVersionError|class file version \d+\.0|only recognizes class file versions/i,
    severity: "error",
    title: "Несовместимая версия Java",
    message:
      "Сбросьте пользовательский путь Java — Onyx автоматически подберёт подходящую версию.",
  },
  {
    code: "missing-dependency",
    pattern:
      /ModResolutionException|requires .+ but|missing (?:mandatory )?dependencies|Dependency resolution failed/i,
    severity: "error",
    title: "Не хватает зависимости мода",
    message:
      "Откройте содержимое инстанса и обновите моды. В журнале ниже указано имя отсутствующей зависимости.",
  },
  {
    code: "mixin-conflict",
    pattern:
      /MixinApplyError|MixinTransformerError|mixin.+(?:failed|error)|InjectionError/i,
    severity: "error",
    title: "Конфликт модов или миксинов",
    message:
      "Один из модов несовместим с текущей версией игры. Обновите моды или временно отключайте последние по одному.",
  },
  {
    code: "native-crash",
    pattern: /EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime/i,
    severity: "warning",
    title: "Сбой драйвера или нативной библиотеки",
    message:
      "Обновите видеодрайвер, отключите оверлеи и проверьте моды рендера. Это не повреждение мира.",
  },
  {
    code: "disk-full",
    pattern:
      /No space left on device|There is not enough space|Недостаточно места на диске/i,
    severity: "error",
    title: "На диске закончилось место",
    message:
      "Освободите место или перенесите папку инстансов через безопасный перенос в настройках.",
  },
  {
    code: "authentication",
    pattern:
      /InvalidCredentialsException|Failed to log in|authentication servers are down/i,
    severity: "warning",
    title: "Проблема авторизации",
    message:
      "Переключите Microsoft-аккаунт или повторите запуск после восстановления сервисов.",
  },
  {
    code: "corrupted-file",
    pattern:
      /zip END header not found|invalid (?:LOC|CEN) header|zip file is empty|checksum (?:failed|mismatch)|hash mismatch/i,
    severity: "error",
    title: "Повреждён файл игры или мода",
    message:
      "Запустите автоматическое восстановление — Onyx перекачает только повреждённые файлы.",
  },
  {
    code: "bad-jvm-arguments",
    pattern:
      /Unrecognized VM option|Could not create the Java Virtual Machine|Invalid maximum heap size/i,
    severity: "error",
    title: "Java не принимает параметры запуска",
    message:
      "Сбросьте пользовательские JVM-аргументы и проверьте объём выделенной памяти.",
  },
  {
    code: "graphics-init",
    pattern:
      /GLFW error|OpenGL[^\n]*(?:not supported|failed|error)|Failed to create window|Pixel format launch/i,
    severity: "error",
    title: "Minecraft не смог запустить графику",
    message:
      "Обновите видеодрайвер и отключите несовместимые моды рендера или оверлеи.",
  },
  {
    code: "permission-denied",
    pattern:
      /AccessDeniedException|Permission denied|Отказано в доступе|Доступ запрещен/i,
    severity: "error",
    title: "Нет доступа к файлам инстанса",
    message:
      "Проверьте владельца и права папки либо перенесите инстансы в доступный каталог.",
  },
];

function analyzeMinecraftLog(content = "") {
  const text = String(content).slice(-500_000);
  return RULES.filter((rule) => rule.pattern.test(text)).map(
    ({ pattern: _pattern, ...diagnosis }) => diagnosis,
  );
}

module.exports = {
  RULES,
  analyzeMinecraftLog,
};
