import { m } from "@/paraglide/messages.js";
import { BIO_MAX, bioLength, normalizeBio } from "@/shared/bio";

export type ProfileFieldsProps = {
  name: string;
  bio: string;
  onNameChange(name: string): void;
  onBioChange(bio: string): void;
};

// 昵称和简介两个输入框，个人资料页和首次登录引导页共用（spec 第 10.5 节的规则在 src/shared）。
// 昵称和简介都不设 maxLength：浏览器按 UTF-16 码元数，表情会被算成两个，而规则按码点数。设了会挡住合法的昵称，
// 预填的第三方昵称（按码点截到 24 个，最多 48 个码元）一改也会被浏览器判为超长。简介的字数按码点在旁边显示；
// 两个字段超了都在提交时再提示。
export function ProfileFields({ name, bio, onNameChange, onBioChange }: ProfileFieldsProps) {
  const count = bioLength(normalizeBio(bio));
  return (
    <>
      <p>
        <label>
          {m.profile_nickname()}{" "}
          <input
            name="nickname"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            required
            autoComplete="nickname"
          />
        </label>
      </p>
      <p>{m.profile_nickname_hint()}</p>
      <p>
        <label>
          {m.profile_bio()}
          <br />
          <textarea name="bio" value={bio} onChange={(event) => onBioChange(event.target.value)} rows={5} cols={40} />
        </label>
      </p>
      <p>
        {m.profile_bio_hint()} <span aria-live="polite">{m.profile_bio_count({ count, max: BIO_MAX })}</span>
      </p>
    </>
  );
}
