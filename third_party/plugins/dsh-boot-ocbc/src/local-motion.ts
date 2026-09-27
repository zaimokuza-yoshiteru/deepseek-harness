// Inverse, continuous texture displacement: no moving cutout and no uncovered source hole.
// Fields vanish before the face and at the root. Source-native pose motion remains underneath.
export function localMotion(width:number,height:number){
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
 if(!gl)return {available:false,draw:(source:HTMLCanvasElement,_t:number)=>source};
 function shader(type:number,source:string){const s=gl!.createShader(type)!;gl!.shaderSource(s,source);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS)){const message=gl!.getShaderInfoLog(s)??'Shader failed';gl!.deleteShader(s);throw Error(message)}return s}
 const p=gl.createProgram()!;
 const vertexShader=shader(gl.VERTEX_SHADER,`#version 300 es
 in vec2 position;out vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`);
 const fragmentShader=shader(gl.FRAGMENT_SHADER,`#version 300 es
 precision highp float;uniform sampler2D image;uniform float time;in vec2 uv;out vec4 color;
 float bell(vec2 p,vec2 center,vec2 radius){vec2 q=(p-center)/radius;return exp(-dot(q,q)*2.);}
 void main(){
  vec2 p=vec2(uv.x,1.-uv.y)*vec2(1280.,720.);
  float enter=smoothstep(3.35,4.4,time);
  float twitch=exp(-pow((time-4.55)/.28,2.))-.35*exp(-pow((time-4.98)/.35,2.));
  float idle=sin((time-3.35)*2.05)+.32*sin((time-3.35)*3.7);
  float ear=bell(p,vec2(544.,491.),vec2(145.,105.))*(1.-smoothstep(650.,755.,p.x));
  float bow=bell(p,vec2(649.,194.),vec2(85.,106.));
  float tail=bell(p,vec2(532.,651.),vec2(155.,96.));
  float guard=1.-smoothstep(730.,815.,p.x);
  vec2 d=vec2(.32,-1.)*ear*(2.2*idle+3.6*twitch);
  d+=vec2(.35,.55)*bow*sin((time-3.6)*1.9);
  d+=vec2(1.,-.35)*tail*sin((time-3.8)*1.6)*1.7;
  p-=d*enter*guard;
  color=texture(image,p/vec2(1280.,720.));
 }`);
 gl.attachShader(p,vertexShader);gl.attachShader(p,fragmentShader);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(p)??'Link failed';gl.deleteShader(vertexShader);gl.deleteShader(fragmentShader);gl.deleteProgram(p);gl.getExtension('WEBGL_lose_context')?.loseContext();throw Error(message)}gl.useProgram(p);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const loc=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 const timeLoc=gl.getUniformLocation(p,'time');
 let disposed=false;
 return {available:true,draw:(source:HTMLCanvasElement,t:number)=>{if(disposed||t<=3.35)return source;gl.uniform1f(timeLoc,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,6);return canvas},dispose:()=>{if(disposed)return;disposed=true;gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteShader(vertexShader);gl.deleteShader(fragmentShader);gl.deleteProgram(p);gl.getExtension('WEBGL_lose_context')?.loseContext()}};
}
