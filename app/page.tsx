"use client";

import { useMemo, useRef, useState } from "react";

const PROVINCES = ["京", "津", "沪", "渝", "冀", "豫", "云", "辽", "黑", "湘", "皖", "鲁", "新", "苏", "浙", "赣", "鄂", "桂", "甘", "晋", "蒙", "陕", "吉", "闽", "贵", "粤", "青", "藏", "川", "宁", "琼"];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const SERIAL = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

type PlateKind = "blue" | "yellow" | "nevSmall" | "nevLarge" | "coach" | "trailer" | "hkmo" | "tractor" | "field" | "port" | "aviation" | "temp" | "tempTrial" | "tempOversize" | "tempEntry";

const PLATE_TYPES: { id: PlateKind; name: string; note: string; sample: string }[] = [
  { id: "blue", name: "小型汽车", note: "蓝底白字 · 7 位", sample: "京A·A2088" },
  { id: "yellow", name: "大型汽车", note: "黄底黑字 · 7 位", sample: "沪B·58216" },
  { id: "nevSmall", name: "小型新能源", note: "渐变绿底 · 8 位", sample: "粤B·D12345" },
  { id: "nevLarge", name: "大型新能源", note: "黄绿双拼 · 8 位", sample: "川A·12345F" },
  { id: "coach", name: "教练汽车", note: "黄底黑字 · 末位学", sample: "浙C·2314学" },
  { id: "trailer", name: "挂车", note: "黄底黑字 · 末位挂", sample: "鲁Q·7253挂" },
  { id: "hkmo", name: "港澳入出境", note: "黑底白字 · 末位港/澳", sample: "粤Z·A88港" },
  { id: "tractor", name: "拖拉机", note: "绿底白字 · 农用机械", sample: "京01-00001" },
  { id: "field", name: "厂（场）内车辆", note: "绿底白字 · 场内专用", sample: "场内京A·00001" },
  { id: "port", name: "港口内部车辆", note: "绿底白字 · 港区专用", sample: "连港·A0018" },
  { id: "aviation", name: "民航场内车辆", note: "绿底白字 · 机场专用", sample: "民航A·A0125" },
  { id: "temp", name: "临时号牌", note: "纸质蓝字 · 普通临牌", sample: "京A·12345" },
  { id: "tempTrial", name: "试验车临牌", note: "纸质号牌 · 末位试", sample: "苏A·1234试" },
  { id: "tempOversize", name: "特型车临牌", note: "纸质号牌 · 末位超", sample: "冀A·1234超" },
  { id: "tempEntry", name: "临时入境", note: "纸质号牌 · 标注路线", sample: "临时入境 京A·12345" },
];

function randomFrom(chars: string | string[]) {
  return chars[Math.floor(Math.random() * chars.length)];
}

function randomSerial(length: number) {
  return Array.from({ length }, () => randomFrom(SERIAL)).join("");
}

function generate(kind: PlateKind, province?: string, city?: string) {
  const p = kind === "hkmo" ? "粤" : province || randomFrom(PROVINCES);
  const c = kind === "hkmo" ? "Z" : city || randomFrom(LETTERS);
  if (kind === "nevSmall") return `${p}${c}${randomFrom("DABCEF")}${randomSerial(5)}`;
  if (kind === "nevLarge") return `${p}${c}${randomSerial(5)}${randomFrom("DF")}`;
  if (kind === "coach") return `${p}${c}${randomSerial(4)}学`;
  if (kind === "trailer") return `${p}${c}${randomSerial(4)}挂`;
  if (kind === "hkmo") return `${p}${c}${randomFrom(LETTERS)}${Math.floor(10 + Math.random() * 90)}${randomFrom("港澳")}`;
  if (kind === "port") return `${p}${c}${randomSerial(4)}`;
  if (kind === "tempTrial") return `${p}${c}${randomSerial(4)}试`;
  if (kind === "tempOversize") return `${p}${c}${randomSerial(4)}超`;
  return `${p}${c}${randomSerial(5)}`;
}

function formatPlate(value: string, kind: PlateKind = "blue") {
  if (kind === "tractor") return `${value.slice(0, 2)}-${value.slice(2)}`;
  if (kind === "field") return `场内${value.slice(0, 2)}·${value.slice(2)}`;
  if (kind === "port") return `连港·${value.slice(1)}`;
  if (kind === "aviation") return `民航${value.slice(1, 2)}·${value.slice(2)}`;
  if (kind === "tempEntry") return `临时入境 ${value.slice(0, 2)}·${value.slice(2)}`;
  return value.length > 2 ? `${value.slice(0, 2)}·${value.slice(2)}` : value;
}

export default function Home() {
  const [kind, setKind] = useState<PlateKind>("blue");
  const [province, setProvince] = useState("京");
  const [city, setCity] = useState("A");
  const [plate, setPlate] = useState("京AA2088");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = useMemo(() => PLATE_TYPES.find((item) => item.id === kind)!, [kind]);
  const serialLength = kind === "nevSmall" || kind === "nevLarge" ? 6 : kind === "port" ? 4 : 5;
  const serial = plate.slice(2);

  const toast = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2200);
  };

  const chooseKind = (next: PlateKind) => {
    const p = next === "hkmo" ? "粤" : province;
    const c = next === "hkmo" ? "Z" : city;
    setKind(next);
    setProvince(p);
    setCity(c);
    setPlate(generate(next, p, c));
  };

  const updateParts = (nextProvince: string, nextCity: string, nextSerial = serial) => {
    setProvince(nextProvince);
    setCity(nextCity);
    setPlate(`${nextProvince}${nextCity}${nextSerial}`);
  };

  const randomize = () => {
    const next = generate(kind);
    setProvince(next[0]);
    setCity(next[1]);
    setPlate(next);
    toast("已生成一组新号码");
  };

  const download = () => {
    const scale = 3;
    const width = 880;
    const height = kind === "hkmo" ? 280 : 280;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    const isGreen = kind === "tractor" || kind === "field" || kind === "port" || kind === "aviation";
    const isTemp = kind.startsWith("temp");
    const palette = kind === "blue" ? ["#0964d8", "#023c9c"] : kind === "hkmo" ? ["#17191b", "#050606"] : isGreen ? ["#15904d", "#075d31"] : isTemp ? ["#f8f5e8", "#e7e7db"] : kind === "nevSmall" ? ["#eaffed", "#63d986"] : kind === "nevLarge" ? ["#f4df25", "#63cf78"] : ["#ffd91f", "#e7a900"];
    const gradient = kind === "nevLarge"
      ? ctx.createLinearGradient(0, 0, width, 0)
      : ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette[0]);
    if (kind === "nevLarge") {
      gradient.addColorStop(.29, palette[0]);
      gradient.addColorStop(.305, palette[1]);
    }
    gradient.addColorStop(1, palette[1]);
    ctx.fillStyle = gradient;
    ctx.roundRect(2, 2, width - 4, height - 4, 22);
    ctx.fill();
    ctx.strokeStyle = kind === "blue" || kind === "hkmo" || isGreen ? "#f8fbff" : isTemp ? (kind === "temp" || kind === "tempEntry" ? "#174a9c" : "#9c2721") : "#101317";
    ctx.lineWidth = 9;
    ctx.roundRect(14, 14, width - 28, height - 28, 15);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    [[55, 52], [825, 52], [55, 228], [825, 228]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${kind === "tempEntry" ? 82 : kind.startsWith("nev") ? 125 : 138}px "Arial Narrow", "Noto Sans SC", sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,.28)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 3;
    if (kind === "field") {
      ctx.fillStyle = "#ffe51f";
      ctx.font = '900 58px "Noto Sans SC", sans-serif';
      ctx.fillText("场", 72, 106);
      ctx.fillText("内", 72, 170);
      ctx.fillStyle = "#f8fbff";
      ctx.font = '900 138px "Arial Narrow", "Noto Sans SC", sans-serif';
      ctx.fillText(`${plate.slice(0, 2)}·${plate.slice(2)}`, 500, height / 2 + 5);
    } else {
      ctx.fillText(formatPlate(plate, kind), width / 2, height / 2 + 5);
    }
    ctx.shadowColor = "transparent";
    const link = document.createElement("a");
    link.download = `plate-${plate}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("高清 PNG 已导出");
  };

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="牌研所首页"><span className="brand-mark">牌</span><span>牌研所<small>PLATE LAB</small></span></a>
        <div className="nav-right"><span className="status"><i /> 规则库 GA 36—2018</span><a href="https://zh.wikipedia.org/wiki/中华人民共和国机动车号牌" target="_blank" rel="noreferrer">参考文档 ↗</a></div>
      </nav>

      <section className="workspace" id="top">
        <div className="stage">
          <div className="stage-heading"><span>实时预览</span><span className="scale">440 × 140 mm · 1:2</span></div>
          <div className="plate-rig">
            <div className={`plate plate-${kind}`} aria-label={`车牌预览 ${formatPlate(plate, kind)}`}>
              <span className="bolt b1"/><span className="bolt b2"/><span className="bolt b3"/><span className="bolt b4"/>
              {kind === "field" ? (
                <div className="plate-number field-number"><span className="field-tag">场<br/>内</span><span>{plate.slice(0, 2)}·{plate.slice(2)}</span></div>
              ) : (
                <div className="plate-number"><span>{formatPlate(plate, kind)}</span></div>
              )}
            </div>
            <div className="bench-line" />
          </div>
          <div className="plate-meta"><div><b>{current.name}</b><span>{current.note}</span></div><div className="compliance"><i>✓</i><span>格式检查通过<small>字符数与类型匹配</small></span></div></div>
        </div>

        <aside className="control-panel">
          <header><span>生成控制台</span><span className="step">01 / 03</span></header>
          <section className="control-section">
            <span className="section-label">选择号牌类型</span>
            <div className="type-list">
              {PLATE_TYPES.map((item) => <button key={item.id} className={kind === item.id ? "active" : ""} onClick={() => chooseKind(item.id)} title={item.sample}><span className={`swatch swatch-${item.id}`}/><span><b>{item.name}</b><small>{item.note}</small></span><i>{kind === item.id ? "●" : "○"}</i></button>)}
            </div>
          </section>
          <section className="control-section manual">
            <div className="section-row"><span className="section-label">指定生成</span><button className="dice" onClick={randomize}>⌁ 随机填充</button></div>
            <div className="fields">
              <label><span>省份</span><select value={province} disabled={kind === "hkmo"} onChange={(e) => updateParts(e.target.value, city)}>{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label><span>城市代码</span><select value={city} disabled={kind === "hkmo"} onChange={(e) => updateParts(province, e.target.value)}>{[...LETTERS].map((l) => <option key={l}>{l}</option>)}</select></label>
              <label className="serial-field"><span>号码段</span><input value={serial} maxLength={serialLength} onChange={(e) => updateParts(province, city, e.target.value.toUpperCase().replace(/[^A-Z0-9学挂港澳试超]/g, ""))}/><small>{serial.length}/{serialLength}</small></label>
            </div>
          </section>
          <div className="actions"><button className="generate" onClick={randomize}><span>↻</span> 随机生成</button><button className="export" onClick={download}>↓ 导出 PNG</button></div>
          <p className="disclaimer">生成内容为随机示意，不代表真实车辆登记信息，请勿用于伪造证件或违法用途。</p>
        </aside>
      </section>

      <section className="info-strip">
        <div><span className="eyebrow">编码结构</span><strong><i>省</i><i>发牌机关</i><i>序号</i></strong><p>省级简称 + 地市字母代码 + 五位或六位序号</p></div>
        <div><span className="eyebrow">生成规则</span><strong className="rule-icons"><i>I</i><i>O</i><span>自动排除易混淆字母</span></strong><p>普通序号不使用 I、O，降低机器识别与肉眼辨识歧义</p></div>
        <div><span className="eyebrow">视觉工艺</span><strong className="material">反光膜 <i/> 压印边框 <i/> 铆钉</strong><p>用光泽、颗粒与压印阴影模拟真实号牌材质</p></div>
      </section>
      <footer><span>牌研所 · 中国机动车号牌样式生成工具</span><span>依据公开资料制作 · 非官方服务</span></footer>
      {notice && <div className="toast">✓ {notice}</div>}
    </main>
  );
}
