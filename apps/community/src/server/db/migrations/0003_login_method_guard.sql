-- "至少一种登录方式"（spec 第 10.4 节）在数据库这一层的兜底。解绑和删除通行密钥的钩子（src/server/auth/account-rules.ts）
-- 先数一遍再删，挡住一般情况并给出 400 LAST_LOGIN_METHOD；但两个并发的删除（一个解绑、一个删通行密钥）各自数到 2，
-- 就会把人删到 0 种。这个约束触发器推迟到提交时才检查：先锁住用户行，同一个用户的检查排队执行，后提交的那个
-- 能看到先提交的删除。用户行本身被删掉时（注销的最终清除，绑定和通行密钥跟着级联删除）放行。
CREATE FUNCTION "keep_one_login_method"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE "id" = OLD."user_id" FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "account" WHERE "user_id" = OLD."user_id")
    AND NOT EXISTS (SELECT 1 FROM "passkey" WHERE "user_id" = OLD."user_id") THEN
    RAISE EXCEPTION 'a user must keep at least one way to sign in' USING ERRCODE = 'AX001';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "account_keep_one_login_method"
  AFTER DELETE ON "account"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "keep_one_login_method"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "passkey_keep_one_login_method"
  AFTER DELETE ON "passkey"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "keep_one_login_method"();
