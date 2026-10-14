// Dollar delimiters with backslash parity, including Yank Note's $\\$ line break.
// Each Markdown instance owns its renderer; warnings cannot leak between files.
module.exports = function math(md, render) {
  function closing(source, from, marker, limit = source.length) {
    let at = from;
    while ((at = source.indexOf(marker, at)) >= 0 && at < limit) {
      let slashes = 0;
      for (let i = at - 1; i >= from && source[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 0 && (marker.length === 2 || (source[at + 1] !== '$' && source[at - 1] !== '$'))) return at;
      at += marker.length;
    }
    return -1;
  }
  md.inline.ruler.before('escape','dollar-math',(state,silent)=>{
    if(state.src[state.pos]!=='$')return false;
    const marker=state.src[state.pos+1]==='$'?'$$':'$';
    const from=state.pos+marker.length;
    const end=closing(state.src,from,marker,state.posMax);
    if(end<0 || end===from)return false;
    const content=state.src.slice(from,end);
    if(content.includes('\n\n'))return false;
    if(!silent){const token=state.push(marker.length===2?'math_display':'math_inline','math',0);token.content=content;}
    state.pos=end+marker.length;return true;
  });
  md.block.ruler.before('fence','dollar-math-block',(state,start,end,silent)=>{
    const from=state.bMarks[start]+state.tShift[start];
    if(!state.src.startsWith('$$',from))return false;
    const close=closing(state.src,from+2,'$$',end<state.bMarks.length?state.bMarks[end]:state.src.length);
    if(close<0)return false;
    let last=start;
    while(last+1<end&&state.bMarks[last+1]<=close)last++;
    if(state.src.slice(close+2,state.eMarks[last]).trim())return false;
    if(!silent){const token=state.push('math_block','math',0);token.block=true;token.content=state.src.slice(from+2,close).trim();token.map=[start,last+1];state.line=last+1;}
    return true;
  },{alt:['paragraph','reference','blockquote','list']});
  md.renderer.rules.math_inline=(tokens,i)=>render(tokens[i].content,false);
  md.renderer.rules.math_display=(tokens,i)=>render(tokens[i].content,true);
  md.renderer.rules.math_block=(tokens,i)=>'<div class="math-block">'+render(tokens[i].content,true)+'</div>\n';
};
