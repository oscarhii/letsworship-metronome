document.addEventListener('DOMContentLoaded', () => {
  const audio = new MetronomeAudioEngine();
  const sync = new MetronomeSyncEngine(audio);
  const el = (id) => document.getElementById(id);

  const bpmDisplay = el('bpm-display');
  const tempoMarking = el('tempo-marking');
  const tempoSlider = el('tempo-slider');
  const btnPlay = el('btn-play-sync');
  const playIcon = el('play-icon');
  const playText = el('play-text');
  const dialProgress = el('dial-progress');
  const beatDots = el('beat-dots');
  const flashOverlay = el('flash-overlay');
  const statusPill = el('status-pill');
  const statusText = el('status-text');
  const roomBadge = el('room-badge');
  const soundSelect = el('sound-select');
  const delaySlider = el('delay-slider');
  const delayLabel = el('delay-val-label');
  const flashToggle = el('flash-toggle');
  const wakeToggle = el('wakelock-toggle');
  const audioBanner = el('audio-unlock-banner');

  const modal = el('qr-modal');
  const pairingActions = el('pairing-actions');
  const instructions = el('pairing-instructions');
  const qrFrame = el('qr-frame-box');
  const qrContainer = el('qrcode-canvas-container');
  const scannerBox = el('scanner-box');
  const video = el('qr-video');
  const scanCanvas = el('qr-scan-canvas');
  const codeBox = el('pairing-code-box');
  const codeInput = el('pairing-code-input');
  const pairingStatus = el('pairing-status');
  const addDeviceButton = el('btn-add-device');
  const scanResponseButton = el('btn-scan-response');

  let tapTimes = [];
  let wakeLock = null;
  let cameraStream = null;
  let scanFrame = null;
  let expectedCode = null;

  const urlParams = new URLSearchParams(location.search);
  const initialRoom = urlParams.get('room') || 'MAIN';

  function tempoName(bpm) {
    if (bpm < 45) return 'Grave';
    if (bpm < 60) return 'Largo';
    if (bpm < 66) return 'Larghetto';
    if (bpm < 76) return 'Adagio';
    if (bpm < 108) return 'Andante';
    if (bpm < 120) return 'Moderato';
    if (bpm < 156) return 'Allegro';
    if (bpm < 176) return 'Vivace';
    if (bpm < 200) return 'Presto';
    return 'Prestissimo';
  }

  function renderDots() {
    beatDots.innerHTML = '';
    for (let i = 1; i <= sync.beatsPerMeasure; i += 1) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot' + (i === 1 ? ' accent-spot' : '');
      beatDots.appendChild(dot);
    }
    document.querySelectorAll('.segment-btn').forEach((button) => {
      button.classList.toggle('active', parseInt(button.dataset.beats, 10) === sync.beatsPerMeasure);
    });
  }

  function updateUI() {
    bpmDisplay.textContent = sync.bpm;
    tempoSlider.value = sync.bpm;
    tempoMarking.textContent = tempoName(sync.bpm);
    dialProgress.style.strokeDashoffset = 2 * Math.PI * 90 * (1 - (sync.bpm - 30) / 250);
    roomBadge.textContent = 'Room: ' + sync.roomId;
    if (sync.isPlaying) {
      btnPlay.classList.add('playing');
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
      playText.textContent = 'STOP SYNC';
    } else {
      btnPlay.classList.remove('playing');
      playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      playText.textContent = 'START SYNC';
      beatDots.querySelectorAll('.beat-dot').forEach((dot) => dot.classList.remove('active'));
    }
    renderDots();
  }

  sync.onBeat = (beat, accent) => {
    beatDots.querySelectorAll('.beat-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index + 1 === beat);
    });
    if (flashToggle.checked) {
      flashOverlay.className = accent ? 'flashing accent' : 'flashing';
      setTimeout(() => { flashOverlay.className = ''; }, 70);
    }
  };
  sync.onStateChange = updateUI;
  sync.onConnectionChange = (connected, count, rtt, role) => {
    statusPill.classList.toggle('connected', connected);
    if (role === 'host') statusText.textContent = 'Host · ' + count + ' devices';
    else if (role === 'guest' && connected) statusText.textContent = 'Joined · ' + (rtt ? rtt + 'ms' : 'syncing');
    else if (role === 'guest') statusText.textContent = 'Pairing...';
    else statusText.textContent = 'Standalone';
  };

  function changeTempo(delta) {
    sync.sendTempo(Math.min(280, Math.max(30, sync.bpm + delta)));
    updateUI();
  }
  el('btn-minus-1').onclick = () => changeTempo(-1);
  el('btn-plus-1').onclick = () => changeTempo(1);
  el('btn-minus-5').onclick = () => changeTempo(-5);
  el('btn-plus-5').onclick = () => changeTempo(5);
  tempoSlider.oninput = (event) => { sync.sendTempo(parseInt(event.target.value, 10)); updateUI(); };

  el('btn-tap-tempo').onclick = () => {
    const now = performance.now();
    tapTimes.push(now);
    tapTimes = tapTimes.filter((time) => now - time < 3000);
    if (tapTimes.length > 1) {
      const intervals = tapTimes.slice(1).map((time, index) => time - tapTimes[index]);
      const bpm = Math.round(60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length));
      sync.sendTempo(Math.min(280, Math.max(30, bpm)));
      updateUI();
    }
  };

  btnPlay.onclick = () => {
    audio.init();
    if (sync.isPlaying) sync.sendStop();
    else sync.sendStart(sync.bpm, sync.beatsPerMeasure);
  };
  document.querySelectorAll('.segment-btn').forEach((button) => {
    button.onclick = () => { sync.sendBeatsPerMeasure(parseInt(button.dataset.beats, 10)); updateUI(); };
  });
  soundSelect.onchange = (event) => sync.sendSoundType(event.target.value);
  delaySlider.oninput = (event) => {
    const value = parseInt(event.target.value, 10);
    delayLabel.textContent = (value > 0 ? '+' : '') + value + ' ms';
    sync.setHardwareDelay(value);
  };

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  wakeToggle.onchange = () => {
    if (wakeToggle.checked) requestWakeLock();
    else if (wakeLock) { wakeLock.release(); wakeLock = null; }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeToggle.checked) requestWakeLock();
  });

  function unlockAudio() {
    audio.init();
    audioBanner.classList.toggle('show', Boolean(audio.audioCtx && audio.audioCtx.state === 'suspended'));
  }
  audioBanner.onclick = unlockAudio;
  document.body.addEventListener('touchstart', unlockAudio, { once: true });
  document.body.addEventListener('click', unlockAudio, { once: true });

  roomBadge.onclick = () => {
    const value = prompt('Room name:', sync.roomId);
    if (value) { sync.init(value); updateUI(); }
  };

  function show(node, visible) { node.classList.toggle('pairing-hidden', !visible); }
  function renderQr(code) {
    qrContainer.innerHTML = '';
    show(qrFrame, true);
    new QRCode(qrContainer, {
      text: code, width: 220, height: 220,
      colorDark: '#0a0e1a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L
    });
  }

  function resetPairingView() {
    stopScanner();
    pairingActions.classList.remove('pairing-hidden');
    show(qrFrame, false);
    show(scannerBox, false);
    show(codeBox, false);
    show(scanResponseButton, false);
    show(addDeviceButton, false);
    codeInput.value = '';
    pairingStatus.textContent = '';
    expectedCode = null;
    instructions.textContent = 'Keep all devices on the same Wi-Fi or hotspot. No beat data is sent to the internet.';
  }

  async function createInvitation() {
    stopScanner();
    pairingActions.classList.add('pairing-hidden');
    show(codeBox, true);
    show(addDeviceButton, false);
    pairingStatus.textContent = 'Creating a local invitation...';
    try {
      const code = await sync.createHostOffer();
      codeInput.value = code;
      renderQr(code);
      expectedCode = 'answer';
      show(scanResponseButton, true);
      instructions.textContent = 'Let the other device scan this invitation. When it shows a response QR, tap Scan response QR.';
      pairingStatus.textContent = 'Invitation ready.';
    } catch (error) { pairingStatus.textContent = error.message; }
  }

  async function joinRoom() {
    pairingActions.classList.add('pairing-hidden');
    show(qrFrame, false);
    show(codeBox, true);
    show(scanResponseButton, false);
    expectedCode = 'offer';
    instructions.textContent = 'Scan the invitation shown on the host device, or paste its pairing code.';
    pairingStatus.textContent = 'Camera is looking for an invitation...';
    await startScanner();
  }

  async function applyCode(raw) {
    if (!raw || !expectedCode) return;
    stopScanner();
    pairingStatus.textContent = 'Applying pairing data...';
    try {
      if (expectedCode === 'offer') {
        const answer = await sync.acceptOffer(raw);
        codeInput.value = answer;
        renderQr(answer);
        expectedCode = null;
        show(scanResponseButton, false);
        instructions.textContent = 'Show this response QR to the host device. The connection completes when the host scans it.';
        pairingStatus.textContent = 'Response ready.';
      } else {
        await sync.acceptAnswer(raw);
        expectedCode = null;
        show(scanResponseButton, false);
        show(scannerBox, false);
        show(qrFrame, false);
        show(codeBox, false);
        show(addDeviceButton, true);
        pairingStatus.textContent = 'Response accepted. Waiting for the direct connection...';
      }
    } catch (error) {
      pairingStatus.textContent = error.message;
      if (expectedCode) await startScanner();
    }
  }

  async function startScanner() {
    if (!expectedCode || cameraStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      pairingStatus.textContent = 'Camera scanning is unavailable. Use Copy/Paste code instead.';
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
      video.srcObject = cameraStream;
      await video.play();
      show(scannerBox, true);
      scanLoop();
    } catch (_) {
      pairingStatus.textContent = 'Camera permission was not granted. Use Copy/Paste code instead.';
    }
  }

  function scanLoop() {
    if (!cameraStream) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const context = scanCanvas.getContext('2d', { willReadFrequently: true });
      scanCanvas.width = video.videoWidth;
      scanCanvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      const image = context.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      const result = window.jsQR && window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (result && result.data) { applyCode(result.data); return; }
    }
    scanFrame = requestAnimationFrame(scanLoop);
  }

  function stopScanner() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = null;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    video.srcObject = null;
    show(scannerBox, false);
  }

  el('btn-qr-modal').onclick = () => { resetPairingView(); modal.classList.add('open'); };
  el('btn-create-room').onclick = createInvitation;
  el('btn-join-room').onclick = joinRoom;
  scanResponseButton.onclick = async () => {
    show(qrFrame, false);
    show(scanResponseButton, false);
    pairingStatus.textContent = 'Camera is looking for the response QR...';
    await startScanner();
  };
  addDeviceButton.onclick = createInvitation;
  el('btn-apply-code').onclick = () => applyCode(codeInput.value);
  el('btn-copy-code').onclick = async () => {
    await navigator.clipboard.writeText(codeInput.value);
    pairingStatus.textContent = 'Pairing code copied.';
  };
  el('btn-paste-code').onclick = async () => {
    try { codeInput.value = await navigator.clipboard.readText(); pairingStatus.textContent = 'Code pasted. Tap Use code.'; }
    catch (_) { pairingStatus.textContent = 'Paste permission denied. Long-press the text box to paste.'; }
  };
  el('btn-close-qr').onclick = () => { stopScanner(); modal.classList.remove('open'); };
  modal.onclick = (event) => {
    if (event.target === modal) { stopScanner(); modal.classList.remove('open'); }
  };

  // Practice and worship features ported from the Android app.
  const defaults = [
    {title:'何等恩典',artist:'敬拜團',bpm:72,key:'D',signature:'4/4',sections:['Intro','Verse 1','Chorus ×2','Bridge','Ending']},
    {title:'祢真偉大',artist:'Traditional',bpm:78,key:'G',signature:'4/4',sections:['Intro','Verse','Chorus','Verse 2','Chorus','Ending']},
    {title:'我神真偉大',artist:'Chris Tomlin',bpm:76,key:'A',signature:'4/4',sections:['Intro','Verse','Chorus ×2','Bridge ×2','Final Chorus']}
  ];
  let songs; try { songs=JSON.parse(localStorage.getItem('syncbeat-songs'))||defaults; } catch(_){ songs=defaults; }
  let currentSong=0,currentSection=0,activeCategory='結構';
  const cueData={
    '結構':['Intro','Verse 1','Pre-Chorus','Chorus','Bridge','Ending'],
    '樂器':['All In','Keys Only','Guitar Only','Drums In','Bass In','A Cappella'],
    '動態':['Build Up','Breakdown','Hold','快一點 +5','慢一點 −5'],
    '結尾':['再一次','Tag','Ending','全停 CUT']
  };
  const directCards=()=>[...document.querySelectorAll('.app-container > .card-main,.app-container > .card-secondary')];
  function setMode(mode){
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    directCards().forEach(n=>n.classList.toggle('mode-panel-hidden',mode==='worship'));
    el('worship-panel').classList.toggle('mode-panel-hidden',mode!=='worship');
    if(mode==='worship') renderWorship();
  }
  document.querySelectorAll('.mode-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  function renderSections(target,sections,selected=-1){
    target.innerHTML=sections.map((s,i)=>'<button class=\'section-chip '+(i===selected?'active':'')+'\' data-index=\''+i+'\'><b>'+s+'</b><small>'+(i===selected?'目前段落':'點選跳轉')+'</small></button>').join('');
  }
  function selectSong(index){
    currentSong=(index+songs.length)%songs.length;currentSection=0;const s=songs[currentSong];
    sync.sendTempo(s.bpm);const beats=parseInt(s.signature,10)||4;sync.sendBeatsPerMeasure(beats);updateUI();renderWorship();
  }
  function renderWorship(){
    const s=songs[currentSong]||defaults[0];
    el('now-playing').innerHTML='<span class=\'song-meta\'>NOW PLAYING · '+s.key+' · '+s.signature+'</span><h2>'+s.title+'</h2><p>'+s.artist+' · '+s.bpm+' BPM</p>';
    renderSections(el('song-sections'),s.sections,currentSection);
    el('song-sections').querySelectorAll('button').forEach(b=>b.onclick=()=>{currentSection=+b.dataset.index;renderWorship();});
    el('song-list').innerHTML=songs.map((x,i)=>'<button class=\'song-row '+(i===currentSong?'active':'')+'\' data-index=\''+i+'\'><b>'+(i+1)+'</b><span>'+x.title+'<small>'+x.artist+'</small></span><em>'+x.bpm+' BPM<br>'+x.key+'</em></button>').join('');
    el('song-list').querySelectorAll('button').forEach(b=>b.onclick=()=>selectSong(+b.dataset.index));
  }
  function showCue(text){
    let banner=el('live-cue');if(!banner){banner=document.createElement('div');banner.id='live-cue';banner.className='live-cue';document.body.appendChild(banner);}banner.textContent=text;banner.classList.add('show');setTimeout(()=>banner.classList.remove('show'),2200);
    if(text.includes('+5')) changeTempo(5);if(text.includes('−5')) changeTempo(-5);
  }
  function renderCues(){
    el('cue-tabs').innerHTML=Object.keys(cueData).map(x=>'<button class=\''+(x===activeCategory?'active':'')+'\'>'+x+'</button>').join('');
    el('cue-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{activeCategory=b.textContent;renderCues();});
    const html=cueData[activeCategory].map(x=>'<button>'+x+'</button>').join('');el('cue-grid').innerHTML=html;el('worship-cues').innerHTML=cueData['結構'].slice(0,6).map(x=>'<button>'+x+'</button>').join('');
    document.querySelectorAll('#cue-grid button,#worship-cues button').forEach(b=>b.onclick=()=>showCue(b.textContent));
  }
  renderSections(el('practice-sections'),defaults[0].sections);renderCues();renderWorship();
  el('prev-song').onclick=()=>selectSong(currentSong-1);el('next-song').onclick=()=>selectSong(currentSong+1);
  el('worship-play').onclick=()=>btnPlay.click();el('advance-section').onclick=()=>{currentSection=(currentSection+1)%songs[currentSong].sections.length;renderWorship();};
  el('load-song').onclick=()=>{const s=songs[currentSong];renderSections(el('practice-sections'),s.sections);showCue('已載入 '+s.title);};
  el('send-custom-cue').onclick=()=>{const input=el('custom-cue');if(input.value.trim()){showCue(input.value.trim());input.value='';}};
  el('add-song').onclick=()=>{const title=prompt('歌曲名稱');if(!title)return;const bpm=Math.max(20,Math.min(300,parseInt(prompt('BPM','120'),10)||120));songs.push({title,artist:'',bpm,key:'C',signature:'4/4',sections:['Intro','Verse','Chorus','Ending']});localStorage.setItem('syncbeat-songs',JSON.stringify(songs));selectSong(songs.length-1);};

  // Full worship setlist management and Android-style sub-navigation.
  songs=songs.map((s,i)=>Object.assign({id:'song_'+i,artist:'',key:'C',signature:'4/4',capo:'',notes:'',youtubeUrl:'',lyrics:'',hidden:false},s));
  let setlist;try{setlist=JSON.parse(localStorage.getItem('syncbeat-setlist-info'))||{};}catch(_){setlist={};}
  setlist=Object.assign({name:'主日敬拜',serviceDate:new Date().toLocaleDateString('zh-TW'),leader:'',vocals:'',musicians:'',notes:''},setlist);
  let library;try{library=JSON.parse(localStorage.getItem('syncbeat-library'))||[];}catch(_){library=[];}
  function persist(){localStorage.setItem('syncbeat-songs',JSON.stringify(songs));localStorage.setItem('syncbeat-setlist-info',JSON.stringify(setlist));localStorage.setItem('syncbeat-library',JSON.stringify(library));}
  function safe(value){const node=document.createElement('span');node.textContent=value==null?'':value;return node.innerHTML;}
  function openDialog(title,body,onSave,saveLabel='儲存'){
    let d=el('app-dialog');if(d)d.remove();d=document.createElement('dialog');d.id='app-dialog';d.className='app-dialog';
    d.innerHTML='<form method=dialog><header><h2>'+safe(title)+'</h2><button value=cancel>×</button></header>'+body+'<menu><button value=cancel>取消</button><button class=primary value=default>'+saveLabel+'</button></menu></form>';
    document.body.appendChild(d);d.querySelector('form').addEventListener('submit',e=>{if(e.submitter&&e.submitter.value==='default'){e.preventDefault();if(onSave(d)!==false)d.close();}});d.addEventListener('close',()=>d.remove());d.showModal();return d;
  }
  function field(label,name,value='',type='text'){return '<label>'+label+'</label><input data-field='+name+' type='+type+' value=\''+safe(value)+'\'>';}
  function editSong(index){const adding=index==null,s=adding?{title:'',artist:'',bpm:120,key:'C',signature:'4/4',capo:'',notes:'',youtubeUrl:'',lyrics:'',sections:['Intro','Verse','Chorus','Ending']}:songs[index];
    const body='<div class=field-grid>'+field('歌曲名稱','title',s.title)+field('歌手／作者','artist',s.artist)+field('BPM','bpm',s.bpm,'number')+field('Key','key',s.key)+field('拍號','signature',s.signature)+field('Capo','capo',s.capo)+field('YouTube URL','youtubeUrl',s.youtubeUrl)+'</div><label>現場備註</label><textarea data-field=notes rows=2>'+safe(s.notes)+'</textarea><label>和弦與歌詞</label><textarea data-field=lyrics rows=6>'+safe(s.lyrics)+'</textarea><label>歌曲段落（每行一段，可寫 Chorus ×2）</label><textarea data-field=sections rows=6>'+safe(s.sections.join('\n'))+'</textarea>';
    openDialog(adding?'新增歌曲':'編輯歌曲',body,d=>{const get=n=>d.querySelector('[data-field='+n+']').value.trim();const updated=Object.assign({},s,{id:s.id||'song_'+Date.now(),title:get('title'),artist:get('artist'),bpm:Math.max(20,Math.min(300,+get('bpm')||120)),key:get('key')||'C',signature:get('signature')||'4/4',capo:get('capo'),youtubeUrl:get('youtubeUrl'),notes:get('notes'),lyrics:get('lyrics'),sections:get('sections').split(/\n/).map(x=>x.trim()).filter(Boolean)});if(!updated.title)return false;if(adding){songs.push(updated);currentSong=songs.length-1;}else songs[index]=updated;persist();renderWorship();});
  }
  function editSetlist(){const body='<div class=field-grid>'+field('組曲名稱','name',setlist.name)+field('聚會日期','serviceDate',setlist.serviceDate)+field('主領','leader',setlist.leader)+field('歌手','vocals',setlist.vocals)+'</div>'+field('樂手配置','musicians',setlist.musicians)+'<label>團隊備註</label><textarea data-field=notes rows=4>'+safe(setlist.notes)+'</textarea>';
    openDialog('曲目清單與團隊資訊',body,d=>{['name','serviceDate','leader','vocals','musicians','notes'].forEach(n=>setlist[n]=d.querySelector('[data-field='+n+']').value.trim());persist();renderWorship();},'儲存團隊資料');}
  function renderWorshipFull(){const s=songs[currentSong]||songs[0];if(!s)return;el('setlist-name').textContent=setlist.name;el('setlist-info').innerHTML='<b>'+safe(setlist.name)+'</b> · '+songs.length+' 首歌<small>'+safe(setlist.serviceDate)+' · 主領 '+safe(setlist.leader||'未設定')+' · 歌手 '+safe(setlist.vocals||'未設定')+'</small>';
    el('now-playing').innerHTML='<span class=song-meta>NOW PLAYING · '+safe(s.key)+' · '+safe(s.signature)+(s.capo?' · Capo '+safe(s.capo):'')+'</span><h2>'+safe(s.title)+'</h2><p>'+safe(s.artist)+' · '+s.bpm+' BPM</p>'+(s.notes?'<small>'+safe(s.notes)+'</small>':'')+(s.lyrics?'<details><summary>查看和弦與歌詞</summary><pre>'+safe(s.lyrics)+'</pre></details>':'');renderSections(el('song-sections'),s.sections,currentSection);el('song-sections').querySelectorAll('button').forEach(b=>b.onclick=()=>{currentSection=+b.dataset.index;renderWorshipFull();});
    el('song-list').innerHTML=songs.map((x,i)=>'<div class=\'song-row '+(i===currentSong?'active ':'')+(x.hidden?'hidden-song':'')+'\'><b>'+(i+1)+'</b><div class=row-main data-index='+i+'><strong>'+safe(x.title)+'</strong><small>'+safe(x.artist)+' · '+x.bpm+' BPM · Key '+safe(x.key)+' · '+x.sections.length+' 段</small></div><em>'+safe(x.signature)+'</em><div class=song-actions data-index='+i+'><button data-act=up>↑</button><button data-act=down>↓</button><button data-act=edit>編輯</button><button data-act=copy>複製</button><button data-act=hide>'+(x.hidden?'顯示':'隱藏')+'</button><button data-act=library>存入曲庫</button><button class=danger data-act=delete>刪除</button></div></div>').join('');
    el('song-list').querySelectorAll('.row-main').forEach(n=>n.onclick=()=>selectSong(+n.dataset.index));el('song-list').querySelectorAll('.song-actions button').forEach(b=>b.onclick=()=>{const i=+b.parentElement.dataset.index,a=b.dataset.act;if(a==='edit')editSong(i);if(a==='copy'){songs.splice(i+1,0,Object.assign({},songs[i],{id:'song_'+Date.now(),title:songs[i].title+'（副本）'}));}if(a==='hide')songs[i].hidden=!songs[i].hidden;if(a==='library'&&!library.some(x=>x.title===songs[i].title))library.push(Object.assign({},songs[i]));if(a==='delete'&&songs.length>1&&confirm('確定刪除 '+songs[i].title+'？')){songs.splice(i,1);currentSong=Math.min(currentSong,songs.length-1);}if(a==='up'&&i>0)[songs[i-1],songs[i]]=[songs[i],songs[i-1]];if(a==='down'&&i<songs.length-1)[songs[i+1],songs[i]]=[songs[i],songs[i+1]];persist();renderWorshipFull();});
  }
  renderWorship=renderWorshipFull;renderWorshipFull();
  document.querySelectorAll('.worship-tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.worship-tabs button').forEach(x=>x.classList.toggle('active',x===b));const live=b.dataset.wtab==='live';[el('now-playing'),document.querySelector('.song-transport'),el('song-sections').closest('.card-secondary'),el('worship-cues').closest('.card-secondary')].forEach(n=>n.classList.toggle('live-control-hidden',!live));document.querySelector('.setlist-manager').classList.toggle('setlist-control-hidden',live);document.querySelector('.setlist-hero').classList.toggle('setlist-control-hidden',live);});
  document.querySelector('.worship-tabs button[data-wtab=live]').click();
  el('add-song').onclick=()=>editSong(null);el('edit-setlist').onclick=editSetlist;
  el('open-library').onclick=()=>{const body=library.length?library.map((s,i)=>'<div class=song-row><b>'+(i+1)+'</b><span>'+safe(s.title)+'<small>'+s.bpm+' BPM · '+safe(s.key)+'</small></span><button data-library='+i+'>加入</button></div>').join(''):'<p>歌曲庫目前是空的。可從歌單的「存入曲庫」建立。</p>';const d=openDialog('歌曲曲庫',body,()=>true,'完成');d.querySelectorAll('[data-library]').forEach(b=>b.onclick=e=>{e.preventDefault();songs.push(Object.assign({},library[+b.dataset.library],{id:'song_'+Date.now()}));persist();renderWorshipFull();d.close();});};
  el('load-template').onclick=()=>{if(confirm('套用經典四首敬拜流程範本？')){songs=defaults.map((s,i)=>Object.assign({id:'song_'+Date.now()+'_'+i,capo:'',notes:'',youtubeUrl:'',lyrics:'',hidden:false},s));currentSong=0;persist();renderWorshipFull();}};
  el('share-setlist').onclick=async()=>{const text=setlist.name+'\n'+songs.map((s,i)=>(i+1)+'. '+s.title+' ('+s.bpm+' BPM, Key '+s.key+')').join('\n');if(navigator.share)await navigator.share({title:setlist.name,text});else{await navigator.clipboard.writeText(text);showCue('歌單已複製');}};
  el('sync-setlist').onclick=()=>showCue('已同步曲目清單至連線裝置');
  el('import-setlist').onclick=()=>openDialog('匯入曲目清單 JSON','<textarea data-field=json rows=12 placeholder=\'貼上匯出的 JSON\'></textarea>',d=>{try{const value=JSON.parse(d.querySelector('[data-field=json]').value);if(Array.isArray(value.songs))songs=value.songs;if(value.setlist)setlist=value.setlist;persist();renderWorshipFull();return true;}catch(_){alert('JSON 格式不正確');return false;}},'匯入');
  el('edit-practice-sections').onclick=()=>{const body='<label>歌曲段落（每行一段）</label><textarea data-field=sections rows=10>'+safe([...el('practice-sections').querySelectorAll('b')].map(x=>x.textContent).join('\n'))+'</textarea>';openDialog('編輯練習段落',body,d=>{renderSections(el('practice-sections'),d.querySelector('[data-field=sections]').value.split(/\n/).map(x=>x.trim()).filter(Boolean));});};
  el('export-practice').onclick=()=>{const title=el('practice-title').value.trim()||'練習歌曲 '+sync.bpm+' BPM';songs.push({id:'song_'+Date.now(),title,artist:'',bpm:sync.bpm,key:el('practice-key').value||'C',signature:sync.beatsPerMeasure+'/4',capo:el('practice-capo').value,notes:'',youtubeUrl:'',lyrics:'',hidden:false,sections:[...el('practice-sections').querySelectorAll('b')].map(x=>x.textContent)});currentSong=songs.length-1;persist();showCue('已匯出到敬拜歌單');};

  sync.init(initialRoom);
  updateUI();
  if (wakeToggle.checked) requestWakeLock();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
});
