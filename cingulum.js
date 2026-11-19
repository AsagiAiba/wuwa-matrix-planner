const namedCasts={
  '仇远':['答剑·弦歌不辍','答剑·割股之心','答剑·忠烈死节'],
  '坎特蕾拉':['斑驳幻梦','感知汲取','陷溺'],
  '洛瑟菈':['遗忘']
};

// Equipment casts, damage classified as Echo damage, and skills counted as
// Echo casts are three different things in the imported rotation.
export function specialEchoCast(owner,label,hasRoccia){
  const text=String(label??'').split('(')[0].replace(/(?:伤害|施放|释放|普攻·|共鸣技能·|共鸣解放·|重击·|共鸣回路·|【|】)/g,'').trim();
  if(hasRoccia && /^(?:无尽引力)?珍奇箱$/.test(text))return '珍奇箱';
  return namedCasts[owner]?.find(name=>text===name||
    (name==='遗忘' && /^(?:声骸|霜渐)(?:模态)?[·： ]*遗忘$|^遗忘[·（](?:声骸|霜渐)/.test(text)));
}
