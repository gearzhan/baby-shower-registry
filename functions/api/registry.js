// 礼物清单（需登录）：礼物（含认领态）+ 展示配置
// 隐私：claimedById 只用来标记 mine（是不是自己认领的），绝不外传；
// showClaimerNames 关闭（默认）时连认领者姓名/时间也一并剥掉，只留 claimed 标记。
import { getRegistryItems, getConfig, json } from '../lib/kv.js';
import { requireGuest } from '../lib/guard.js';

export async function onRequestGet({ request, env }) {
  const auth = await requireGuest(request, env);
  if (auth.denied) return auth.denied;

  const [items, config] = await Promise.all([getRegistryItems(env), getConfig(env)]);
  const showNames = config.showClaimerNames === true;
  const showPrices = config.showPrices !== false;
  const publicItems = items.map((it) => {
    // 价格开关关闭时，price 必须服务端剥掉 —— 否则宾客在 Network 面板照样能看到主人想藏起来的价格。
    // was 是已废弃的划线价字段：cleanItem 不再产出它，但 admin/items 的 updateItem 是
    // { ...旧记录, ...cleanItem(...) } 合并，KV 里存过的老记录会一直留着它，主人怎么编辑都洗不掉 ——
    // 所以这里仍要继续剥。别当成死代码删掉。
    const priced = showPrices ? it : (({ price, was, ...rest }) => rest)(it);
    if (!priced.claimedBy && !priced.claimedById) return priced;
    // claimedById 必须显式解构出去 —— 它是判断 mine 的依据，但不能落到响应里。
    // receivedAt/thankedAt 是主人专用的收货/致谢进度：getRegistryItems 默认不并入（只有 admin/all 传 withThanks），
    // 这里再显式剥一遍是第二道闸 —— 和上面的 was 一样，别当成死代码删掉。
    // 未认领的分支（上一行提前 return）不用管：这两个字段只会挂在已认领的条目上。
    const { claimedById, claimedBy, claimedAt, receivedAt, thankedAt, ...rest } = priced;
    const mine = !!claimedById && claimedById === auth.guest.id;
    // 自己的认领始终带上姓名（就是自己），别人的认领看 showClaimerNames
    if (mine) return { ...rest, claimed: true, mine: true, claimedBy, claimedAt };
    if (showNames) return { ...rest, claimed: true, claimedBy, claimedAt };
    return { ...rest, claimed: true };
  });
  return json({ items: publicItems, config });
}
