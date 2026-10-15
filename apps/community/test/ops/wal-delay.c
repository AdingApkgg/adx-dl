#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/stat.h>
#include <unistd.h>

/* Isolated PostgreSQL test only. Delay one real WAL sync for one explicitly armed backend. */
static void delay_wal_sync(int fd) {
  int saved = errno;
  char link[64], path[4096];
  snprintf(link, sizeof(link), "/proc/self/fd/%d", fd);
  ssize_t length = readlink(link, path, sizeof(path) - 1);
  if (length < 0) { errno = saved; return; }
  path[length] = '\0';
  if (!strstr(path, "/pg_wal/")) { errno = saved; return; }
  FILE *target = fopen("/wal-delay/target", "r");
  long pid = 0;
  if (target) { if (fscanf(target, "%ld", &pid) != 1) pid = 0; fclose(target); }
  if (pid != (long)getpid()) { errno = saved; return; }
  int once = open("/wal-delay/once", O_WRONLY | O_CREAT | O_EXCL, 0666);
  int marker = once >= 0 ? open("/wal-delay/entered.tmp", O_WRONLY | O_CREAT | O_EXCL, 0666) : -1;
  if (once >= 0) close(once);
  if (marker >= 0) {
    (void)fchmod(marker, 0644);
    char text[64]; int size = snprintf(text, sizeof(text), "%ld\n", pid);
    if (write(marker, text, (size_t)size) < 0) { /* Marker remains sufficient. */ }
    close(marker);
    (void)rename("/wal-delay/entered.tmp", "/wal-delay/entered");
    struct timespec left = { .tv_sec = 3, .tv_nsec = 0 };
    while (nanosleep(&left, &left) == -1 && errno == EINTR) {}
  }
  errno = saved;
}
int fdatasync(int fd) {
  int (*real_sync)(int) = dlsym(RTLD_NEXT, "fdatasync");
  delay_wal_sync(fd); return real_sync(fd);
}
int fsync(int fd) {
  int (*real_sync)(int) = dlsym(RTLD_NEXT, "fsync");
  delay_wal_sync(fd); return real_sync(fd);
}
