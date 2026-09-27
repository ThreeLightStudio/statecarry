#define _DARWIN_C_SOURCE

#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int is_writable_directory(const char *path) {
  struct stat info;

  return stat(path, &info) == 0 && S_ISDIR(info.st_mode) &&
         access(path, W_OK | X_OK) == 0;
}

static int resolve_user_temp_root(char *path, size_t capacity) {
  const char *environment_path = getenv("TMPDIR");
  if (environment_path != NULL && environment_path[0] == '/' &&
      is_writable_directory(environment_path)) {
    int length = snprintf(path, capacity, "%s", environment_path);
    return length > 0 && (size_t)length < capacity ? 0 : -1;
  }

  size_t required = confstr(_CS_DARWIN_USER_TEMP_DIR, NULL, 0);
  if (required == 0 || required > capacity) {
    return -1;
  }

  size_t written = confstr(_CS_DARWIN_USER_TEMP_DIR, path, capacity);
  return written > 0 && written <= capacity && path[0] == '/' &&
                 is_writable_directory(path)
             ? 0
             : -1;
}

int main(int argc, char **argv) {
  (void)argc;

  char user_temp_root[PATH_MAX];
  if (resolve_user_temp_root(user_temp_root, sizeof(user_temp_root)) != 0) {
    fprintf(stderr, "StateCarry could not find a writable user temp directory.\n");
    return 1;
  }

  size_t root_length = strlen(user_temp_root);
  const char *separator = root_length > 0 && user_temp_root[root_length - 1] == '/'
                              ? ""
                              : "/";
  char runtime_temp_template[PATH_MAX];
  int template_length = snprintf(runtime_temp_template,
                                 sizeof(runtime_temp_template),
                                 "%s%sstatecarry-cottontail-XXXXXX",
                                 user_temp_root, separator);
  if (template_length < 0 ||
      (size_t)template_length >= sizeof(runtime_temp_template)) {
    fprintf(stderr, "StateCarry could not create a Cottontail temp path.\n");
    return 1;
  }

  char *runtime_temp_root = mkdtemp(runtime_temp_template);
  if (runtime_temp_root == NULL) {
    fprintf(stderr, "StateCarry could not create Cottontail temp directory: %s\n",
            strerror(errno));
    return 1;
  }

  if (setenv("COTTONTAIL_TMP_DIR", runtime_temp_root, 1) != 0) {
    fprintf(stderr, "StateCarry could not configure Cottontail temp directory: %s\n",
            strerror(errno));
    return 1;
  }

  char executable_path[PATH_MAX];
  uint32_t executable_path_capacity = (uint32_t)sizeof(executable_path);
  if (_NSGetExecutablePath(executable_path, &executable_path_capacity) != 0) {
    fprintf(stderr, "StateCarry could not resolve its packaged launcher path.\n");
    return 1;
  }

  char resolved_executable[PATH_MAX];
  if (realpath(executable_path, resolved_executable) == NULL) {
    fprintf(stderr, "StateCarry could not resolve its packaged launcher: %s\n",
            strerror(errno));
    return 1;
  }

  char *last_separator = strrchr(resolved_executable, '/');
  if (last_separator == NULL) {
    fprintf(stderr, "StateCarry could not find its packaged launcher directory.\n");
    return 1;
  }

  size_t directory_length = (size_t)(last_separator - resolved_executable);
  char original_launcher[PATH_MAX];
  int launcher_length = snprintf(original_launcher, sizeof(original_launcher),
                                 "%.*s/launcher-electrobun",
                                 (int)directory_length, resolved_executable);
  if (launcher_length < 0 || (size_t)launcher_length >= sizeof(original_launcher)) {
    fprintf(stderr, "StateCarry packaged launcher path is too long.\n");
    return 1;
  }

  argv[0] = original_launcher;
  execv(original_launcher, argv);
  fprintf(stderr, "StateCarry could not start packaged launcher: %s\n",
          strerror(errno));
  return 127;
}
