import { avatarColor, avatarInitial } from "@/shared/avatar";

export type AvatarProps = { id: string; name: string; size?: number };

// 默认头像：内联 SVG，不加依赖，也不用额外请求。旁边总会显示昵称，所以对读屏软件隐藏。
export function Avatar({ id, name, size = 40 }: AvatarProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="20" fill={avatarColor(id)} />
      <text x="20" y="20" dominantBaseline="central" textAnchor="middle" fontSize="18" fill="#ffffff">
        {avatarInitial(name)}
      </text>
    </svg>
  );
}
