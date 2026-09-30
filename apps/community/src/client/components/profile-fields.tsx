import { m } from "@/paraglide/messages.js";
import { BIO_MAX, bioLength, normalizeBio } from "@/shared/bio";
import { NICKNAME_MAX } from "@/shared/nickname";

export type ProfileFieldsProps = {
  name: string;
  bio: string;
  onNameChange(name: string): void;
  onBioChange(bio: string): void;
};

// 昵称和简介两个输入框，个人资料页和首次登录引导页共用（spec 第 10.5 节的规则在 src/shared）。
// 简介不设 maxLength：浏览器按 UTF-16 码元数，表情会被算成两个；字数按码点在旁边显示，超了提交时再提示。
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
            maxLength={NICKNAME_MAX}
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
