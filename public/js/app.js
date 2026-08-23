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
  flashToggle.checked=localStorage.getItem('syncbeat-stage-flash')==='true';
  flashToggle.addEventListener('change',()=>localStorage.setItem('syncbeat-stage-flash',String(flashToggle.checked)));
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
  const leaveRoomButton = el('btn-leave-room');
  const scanResponseButton = el('btn-scan-response');
  const cloudRoomCode = el('cloud-room-code');
  const cloudRoomInput = el('cloud-room-input');
  const joinCodeButton = el('btn-join-code');

  let tapTimes = [];
  let wakeLock = null;
  let cameraStream = null;
  let scanFrame = null;
  let expectedCode = null;
  let qrCycleTimer = null;
  let scannedQrParts = new Map();
  const configuredCloudEndpoint = window.SYNCBEAT_CLOUD_ENDPOINT || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8787' : '');
  sync.setCloudEndpoint(configuredCloudEndpoint);

  const urlParams = new URLSearchParams(location.search);
  const initialRoom = urlParams.get('room') || 'MAIN';
  // Connection controls belong to the persistent top information bar.
  const topInfo=document.querySelector('.app-header');
  const topRoom=el('room-badge');
  if(topInfo&&topRoom){topRoom.classList.add('top-room');topInfo.insertBefore(topRoom,topInfo.querySelector('.header-actions'));}
  const topActions=topInfo&&topInfo.querySelector('.header-actions');
  if(topActions&&audioBanner){audioBanner.classList.add('top-audio','show');topActions.insertBefore(audioBanner,topActions.firstChild);}
  let uiLanguage=localStorage.getItem('syncbeat-language')||'en';
  const languageButton=document.createElement('button');languageButton.id='language-toggle';languageButton.className='language-toggle';topActions.insertBefore(languageButton,el('status-pill'));
  const liveCuePanel=document.querySelector('.live-cue-panel');
  if(liveCuePanel&&!el('worship-custom-cue')){const custom=document.createElement('div');custom.className='custom-cue worship-custom-cue';custom.innerHTML='<input id=worship-custom-cue maxlength=60 placeholder=Custom_message><button id=worship-send-custom>BROADCAST</button>';liveCuePanel.appendChild(custom);el('worship-send-custom').onclick=()=>{const input=el('worship-custom-cue');if(input.value.trim()){showCue(input.value.trim(),0,uiLanguage==='zh'?'自訂現場提示':'Custom live cue');input.value='';}};}
  function applyUiLanguage(){const zh=uiLanguage==='zh';languageButton.textContent=zh?'EN':'中';languageButton.title=zh?'Switch to English':'切換至繁體中文';const set=(selector,en,tw)=>{const node=document.querySelector(selector);if(node)node.textContent=zh?tw:en;};set('.mode-btn[data-mode=practice]','☷ Metronome','☷ 節拍器');const worship=document.querySelector('.mode-btn[data-mode=worship]');if(worship)worship.innerHTML=(zh?'▣ 敬拜':'▣ Worship')+' (<span id=mode-song-count>'+songs.length+'</span> '+(zh?'首':'songs')+')';set('.worship-tabs [data-wtab=live]','Live Control','現場控制');set('.worship-tabs [data-wtab=score]','Score','譜面');set('.score-live-beat small','LIVE BEAT','現場節拍');if(roomBadge)roomBadge.textContent=(zh?'房間：':'Room: ')+sync.roomId;const setlistTab=document.querySelector('.worship-tabs [data-wtab=setlist]');if(setlistTab)setlistTab.innerHTML=(zh?'歌單':'Setlist')+' (<span id=setlist-count>'+songs.length+'</span>)';set('.stage-label','ACCENTS','重音設定');set('.time-title','TIME SIGNATURE','拍號');set('.tempo-card summary','Advanced beat settings','進階節拍設定');set('#send-custom-cue','BROADCAST','廣播');set('#edit-setlist','♬ Band Info','♬ 樂團資訊');set('.setlist-more summary','More actions','更多功能');set('.drag-help','⠿ Hold the drag handle, move to reorder, then release','⠿ 按住拖曳把手，移動排序後放開');set('#share-setlist','Share Band Pack','分享樂團包');set('#import-setlist','Import Band Pack','匯入樂團包');set('#sync-setlist','Sync Band','同步樂團');set('#open-library','▣ Library','▣ 曲庫');set('#add-song','＋ Add Song','＋ 新增歌曲');set('#quick-jump','Quick Jump','快速跳曲');if(playText)playText.textContent=sync.isPlaying?(zh?'停止同步節拍器':'STOP SYNC METRONOME'):(zh?'啟動同步節拍器':'START SYNC METRONOME');if(audioBanner)audioBanner.textContent=zh?'點一下啟用聲音':'Tap to activate audio';document.querySelectorAll('.setting-group b').forEach(node=>node.textContent=zh?'📣 現場提示':'📣 LIVE STAGE CUES');document.querySelectorAll('.setting-group small').forEach(node=>node.textContent=zh?'按住提示卡以編輯':'Hold a cue to edit');set('#worship-send-custom','BROADCAST','廣播');const personalNote=el('score-personal-note');if(personalNote)personalNote.placeholder=zh?'我的筆記…':'My note…';const worshipCustom=el('worship-custom-cue');if(worshipCustom)worshipCustom.placeholder=zh?'輸入自訂現場提示…':'Custom live message…';set('#load-template','☷ Templates','☷ 範本');set('#share-setlist','Share','分享');set('#import-setlist','Import','匯入');set('.modal-dialog h2','Connect devices offline','離線連接裝置');set('#btn-copy-code','Copy','複製');set('#btn-paste-code','Paste','貼上');set('#btn-apply-code','Use code','使用代碼');set('#btn-add-device','Add device','新增裝置');set('#btn-close-qr','Close','關閉');set('.live-next-card>div small','HOST · NEXT SONG','HOST · 下一首歌');set('.live-next-card>p','Sync the band without auto-play','同步樂團但不自動播放');const emptyStrong=document.querySelector('.score-empty strong'),emptySmall=document.querySelector('.score-empty small');if(emptyStrong)emptyStrong.textContent=zh?'請從歌單歌曲卡上傳譜面':'Upload scores from the Setlist song card';if(emptySmall)emptySmall.textContent=zh?'使用歌曲旁的 ♬ 按鈕':'Use the ♬ button beside each song.';if(sync&&sync.notifyConnection)sync.notifyConnection();}
  languageButton.onclick=()=>{uiLanguage=uiLanguage==='zh'?'en':'zh';localStorage.setItem('syncbeat-language',uiLanguage);renderCues();renderWorshipFull();applyUiLanguage();};

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
    beatDots.style.setProperty('--accent-columns',Math.min(4,sync.beatsPerMeasure));
    beatDots.dataset.beats=sync.beatsPerMeasure;
    for (let i = 1; i <= sync.beatsPerMeasure; i += 1) {
      const dot = document.createElement('button');
      const type = sync.accentPattern[i - 1] || (i === 1 ? 'accent' : 'normal');
      dot.className = 'beat-dot accent-' + type + (i > Math.floor((sync.beatsPerMeasure - 1) / 4) * 4 ? ' accent-last-row' : '');
      dot.innerHTML = '<span class=accent-glyph>' + (type === 'accent' ? '★' : type === 'normal' ? '●' : type === 'soft' ? '◦' : '×') + '</span><b>' + i + '</b>';
      dot.onclick = () => { const order=['accent','normal','soft','muted']; const pattern=sync.accentPattern.slice(); pattern[i-1]=order[(order.indexOf(type)+1)%order.length]; sync.sendAccentPattern(pattern); renderDots(); };
      beatDots.appendChild(dot);
    }
    const radial=document.querySelector('.radial-stage');
    if(radial){radial.innerHTML=Array.from({length:sync.beatsPerMeasure},(_,index)=>{const angle=-Math.PI/2+(Math.PI*2*index/sync.beatsPerMeasure),x=50+50*Math.cos(angle),y=50+50*Math.sin(angle);return '<i data-orbit-beat="'+(index+1)+'" style="left:calc('+x+'% - var(--orbit-dot)/2);top:calc('+y+'% - var(--orbit-dot)/2)"></i>';}).join('')+'<span class="orbit-runner"></span><b></b>';}
    document.querySelectorAll('.segment-btn').forEach((button) => {
      button.classList.toggle('active', parseInt(button.dataset.beats, 10) === sync.beatsPerMeasure);
    });
  }

  function updateUI() {
    bpmDisplay.textContent = sync.bpm;
    tempoSlider.value = sync.bpm;
    tempoMarking.textContent = tempoName(sync.bpm);
    dialProgress.style.strokeDashoffset = 2 * Math.PI * 90 * (1 - (sync.bpm - 30) / 250);
    roomBadge.textContent = (uiLanguage==='zh'?'房間：':'Room: ') + sync.roomId;
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
    applyUiLanguage();
  }

  sync.onBeat = (beat, accent) => {
    if (audio.soundType === 'voice_en' || audio.soundType === 'voice_zh') audio.speakCount(beat);
    beatDots.querySelectorAll('.beat-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index + 1 === beat);
    });
    const stage=document.querySelector('.radial-stage');
    if(stage){const type=sync.accentPattern[beat-1]||'normal',points=[...stage.querySelectorAll('[data-orbit-beat]')];stage.className='radial-stage';points.forEach((point,index)=>point.classList.toggle('active',index===beat-1));void stage.offsetWidth;stage.classList.add('pulse','pulse-'+type);stage.dataset.beat=beat;const runner=stage.querySelector('.orbit-runner'),at=(beat-1)*360/sync.beatsPerMeasure,next=beat===sync.beatsPerMeasure?360:beat*360/sync.beatsPerMeasure;if(runner){runner.getAnimations().forEach(animation=>animation.cancel());runner.style.transform='rotate('+at+'deg)';runner.animate([{transform:'rotate('+at+'deg)'},{transform:'rotate('+next+'deg)'}],{duration:Math.max(120,60000/sync.bpm),easing:'linear',fill:'forwards'});}}
    const liveProgress=el('live-beat-progress');
    if(liveProgress)liveProgress.querySelectorAll('i').forEach((bar,index)=>{bar.classList.toggle('active',index===beat-1);bar.classList.toggle('accent-beat',(sync.accentPattern[index]||'normal')==='accent');});
    const scoreProgress=el('score-beat-progress');
    if(scoreProgress){if(scoreProgress.children.length!==sync.beatsPerMeasure)scoreProgress.innerHTML=Array.from({length:sync.beatsPerMeasure},()=>'<i></i>').join('');scoreProgress.querySelectorAll('i').forEach((bar,index)=>{bar.classList.toggle('active',index===beat-1);bar.classList.toggle('accent-beat',(sync.accentPattern[index]||'normal')==='accent');});}
    const liveShell=document.querySelector('.live-song-shell');
    if(liveShell&&!liveShell.classList.contains('live-control-hidden')){liveShell.classList.remove('beat-border','beat-border-accent');void liveShell.offsetWidth;liveShell.classList.add('beat-border',accent?'beat-border-accent':'beat-border-normal');}
    if (flashToggle.checked) {
      flashOverlay.className = accent ? 'flashing accent' : 'flashing';
      setTimeout(() => { flashOverlay.className = ''; }, 70);
    }
  };
  sync.onStateChange = updateUI;
  sync.onConnectionChange = (connected, count, rtt, role) => {
    statusPill.classList.toggle('connected', connected);
    if (role === 'host') statusText.textContent = (uiLanguage==='zh'?'主控 Host':'Host') + ' · ' + count + (uiLanguage==='zh'?' 台裝置':' devices');
    else if (role === 'guest' && connected) statusText.textContent = (uiLanguage==='zh'?'跟隨者':'Follower') + ' · ' + (rtt ? rtt + 'ms' : (uiLanguage==='zh'?'同步中':'syncing'));
    else if (role === 'guest') statusText.textContent = 'Pairing...';
    else statusText.textContent = 'Standalone';
    applyRoleUi();
  };

  function applyRoleUi(){
    const follower=sync.role==='guest';
    document.body.classList.toggle('is-follower',follower);
    const controlled=['btn-play-sync','btn-minus-1','btn-tap-tempo','btn-plus-1','tempo-slider','custom-signature','sound-select','btn-minus-5','btn-plus-5','prev-song','next-song','worship-play','advance-section','switch-next','live-minus5','live-plus5','sync-setlist','add-song','edit-setlist','share-setlist','import-setlist','open-library','load-template','send-custom-cue'];
    controlled.forEach(id=>{const node=el(id);if(node){node.disabled=follower;node.title=follower?(uiLanguage==='zh'?'由 Host 控制':'Controlled by Host'):'';}});
    document.querySelectorAll('.segment-btn').forEach(node=>{node.disabled=follower;node.title=follower?(uiLanguage==='zh'?'拍號由 Host 控制':'Time signature is controlled by Host'):'';});
    document.querySelectorAll('#beat-dots button,#song-sections button,#worship-cues button,#cue-grid button,.setlist-manager .row-main').forEach(node=>{node.classList.toggle('host-locked',follower);node.setAttribute('aria-disabled',String(follower));});
    document.querySelectorAll('.setlist-manager .song-actions button').forEach(node=>{const allowed=follower&&['youtube','score'].includes(node.dataset.act);node.disabled=follower&&!allowed;node.classList.toggle('host-locked',follower&&!allowed);node.setAttribute('aria-disabled',String(follower&&!allowed));});
  }

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
    button.onclick = () => {if(sync.role==='guest')return;const parts=button.textContent.trim().split('/');sync.sendTimeSignature(parseInt(parts[0],10),parseInt(parts[1],10)||4);updateUI(); };
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
    clearInterval(qrCycleTimer);
    qrContainer.innerHTML = '';
    show(qrFrame, true);
    let hash=0;for(let i=0;i<code.length;i+=1)hash=(hash*31+code.charCodeAt(i))>>>0;
    const size=420,rawParts=[];for(let offset=0;offset<code.length;offset+=size)rawParts.push(code.slice(offset,offset+size));
    const session=hash.toString(36),parts=rawParts.map((part,index)=>'SBP1|'+session+'|'+index+'|'+rawParts.length+'|'+part);
    let index=0;const paint=()=>{qrContainer.innerHTML='';new QRCode(qrContainer,{text:parts[index],width:288,height:288,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});if(parts.length>1){const label=document.createElement('small');label.className='qr-progress';label.textContent=(uiLanguage==='zh'?'自動分段 QR ':'Auto QR part ')+(index+1)+' / '+parts.length;qrContainer.appendChild(label);}index=(index+1)%parts.length;};paint();if(parts.length>1)qrCycleTimer=setInterval(paint,950);
  }

  function collectScannedQr(value){
    if(!value.startsWith('SBP1|'))return value;
    const pieces=value.split('|'),session=pieces[1],index=+pieces[2],total=+pieces[3],chunk=pieces.slice(4).join('|');
    if(!session||!Number.isInteger(index)||!Number.isInteger(total)||index<0||index>=total||!chunk)return null;
    let record=scannedQrParts.get(session);if(!record||record.total!==total){record={total,parts:new Map()};scannedQrParts.set(session,record);}record.parts.set(index,chunk);
    pairingStatus.textContent=(uiLanguage==='zh'?'已掃描 QR 片段 ':'QR parts scanned ')+record.parts.size+' / '+total;
    if(record.parts.size<total)return null;const result=Array.from({length:total},(_,partIndex)=>record.parts.get(partIndex)||'').join('');scannedQrParts.delete(session);return result;
  }

  function resetPairingView() {
    clearInterval(qrCycleTimer);qrCycleTimer=null;scannedQrParts.clear();
    stopScanner();
    pairingActions.classList.toggle('pairing-hidden',sync.role!=='standalone');
    show(qrFrame, false);
    show(scannerBox, false);
    show(codeBox, false);
    show(cloudRoomCode, false);
    show(scanResponseButton, false);
    show(addDeviceButton, sync.role==='host');
    show(leaveRoomButton, sync.role!=='standalone');
    codeInput.value = '';
    pairingStatus.textContent = '';
    expectedCode = null;
    if(sync.role==='guest')instructions.textContent=uiLanguage==='zh'?'目前是 Follower。請先解除跟隨，才能建立或加入其他房間。':'You are currently a Follower. Leave this role before creating or joining another room.';
    else if(sync.role==='host')instructions.textContent=uiLanguage==='zh'?'目前是 Host。可新增裝置，或先結束 Host 身份再加入其他房間。':'You are the Host. Add another device, or leave the Host role before joining another room.';
    else instructions.textContent = 'Keep all devices on the same Wi-Fi or hotspot. No beat data is sent to the internet.';
    leaveRoomButton.textContent=sync.role==='guest'?(uiLanguage==='zh'?'解除 Follower':'Stop following'):(uiLanguage==='zh'?'結束 Host 房間':'Close Host room');
  }

  async function createInvitation() {
    if(sync.role==='guest'){resetPairingView();pairingStatus.textContent=uiLanguage==='zh'?'請先解除 Follower。':'Leave the Follower role first.';return;}
    stopScanner();
    pairingActions.classList.add('pairing-hidden');
    show(codeBox, true);
    show(addDeviceButton, false);
    pairingStatus.textContent = 'Creating a local invitation...';
    try {
      if (sync.cloudEndpoint) {
        const room = sync.cloudSession && sync.cloudSession.role === 'host'
          ? { code: sync.cloudSession.code, joinToken: sync.cloudSession.joinToken }
          : await sync.createCloudRoom();
        const invitation = 'SBC1|' + sync.cloudEndpoint + '|' + room.code + '|' + room.joinToken;
        codeInput.value = room.code;
        renderQr(invitation);
        expectedCode = null;
        show(scanResponseButton, false);
        show(codeBox, false);
        show(addDeviceButton, true);
        instructions.textContent = 'Room ' + room.code + ' · Followers scan once or enter this six-character code. Valid for 12 hours.';
        pairingStatus.textContent = 'Cloud room connected.';
        updateUI();
        return;
      }
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
    if(sync.role!=='standalone'){resetPairingView();pairingStatus.textContent=uiLanguage==='zh'?'請先離開目前身份。':'Leave the current role first.';return;}
    pairingActions.classList.add('pairing-hidden');
    show(qrFrame, false);
    show(codeBox, true);
    if (sync.cloudEndpoint) {
      show(cloudRoomCode, true);
      show(codeBox, false);
      expectedCode = 'cloud-invite';
      instructions.textContent = 'Scan the Host QR once, or enter the six-character room code.';
      pairingStatus.textContent = 'Camera is looking for a room invitation...';
      await startScanner();
      return;
    }
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
      if (expectedCode === 'cloud-invite') {
        const parts = raw.split('|');
        if (parts.length !== 4 || parts[0] !== 'SBC1') throw new Error('This is not a SyncBeat cloud room invitation.');
        sync.setCloudEndpoint(parts[1]);
        await sync.joinCloudRoom(parts[2], parts[3]);
        expectedCode = null;
        show(cloudRoomCode, false);
        show(codeBox, false);
        show(qrFrame, false);
        instructions.textContent = 'Connected as Follower in room ' + parts[2] + '.';
        pairingStatus.textContent = 'Connected. This device will reconnect automatically.';
        updateUI();
        return;
      }
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
        clearInterval(qrCycleTimer);qrCycleTimer=null;
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
      if (result && result.data) {const complete=collectScannedQr(result.data);if(complete){applyCode(complete);return;}}
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
  statusPill.onclick = () => el('btn-qr-modal').click();
  el('btn-create-room').onclick = createInvitation;
  el('btn-join-room').onclick = joinRoom;
  scanResponseButton.onclick = async () => {
    show(qrFrame, false);
    show(scanResponseButton, false);
    pairingStatus.textContent = 'Camera is looking for the response QR...';
    await startScanner();
  };
  addDeviceButton.onclick = createInvitation;
  joinCodeButton.onclick = async () => {
    const code = cloudRoomInput.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) { pairingStatus.textContent = 'Enter the six-character room code.'; return; }
    stopScanner();
    pairingStatus.textContent = 'Joining room ' + code + '...';
    try {
      await sync.joinCloudRoomByCode(code);
      expectedCode = null;
      show(cloudRoomCode, false);
      instructions.textContent = 'Connected as Follower in room ' + code + '.';
      pairingStatus.textContent = 'Connected. This device will reconnect automatically.';
      updateUI();
    } catch (error) { pairingStatus.textContent = error.message; }
  };
  leaveRoomButton.onclick=()=>{const wasGuest=sync.role==='guest';sync.disconnectAll();resetPairingView();updateUI();pairingStatus.textContent=wasGuest?(uiLanguage==='zh'?'已解除 Follower，可建立或加入房間。':'Follower role removed. You may now create or join a room.'):(uiLanguage==='zh'?'Host 房間已結束。':'Host room closed.');};
  el('btn-apply-code').onclick = () => applyCode(codeInput.value);
  el('btn-copy-code').onclick = async () => {
    await navigator.clipboard.writeText(codeInput.value);
    pairingStatus.textContent = 'Pairing code copied.';
  };
  el('btn-paste-code').onclick = async () => {
    try { codeInput.value = await navigator.clipboard.readText(); pairingStatus.textContent = 'Code pasted. Tap Use code.'; }
    catch (_) { pairingStatus.textContent = 'Paste permission denied. Long-press the text box to paste.'; }
  };
  el('btn-close-qr').onclick = () => { stopScanner();clearInterval(qrCycleTimer);qrCycleTimer=null;modal.classList.remove('open'); };
  modal.onclick = (event) => {
    if (event.target === modal) { stopScanner();clearInterval(qrCycleTimer);qrCycleTimer=null;modal.classList.remove('open'); }
  };

  // Practice and worship features ported from the Android app.
  const defaults = [
    {title:'何等恩典',artist:'敬拜團',bpm:72,key:'D',signature:'4/4',sections:['Intro','Verse 1','Chorus ×2','Bridge','Ending']},
    {title:'更深經歷你',artist:'Traditional',bpm:78,key:'G',signature:'4/4',sections:['Intro','Verse','Chorus','Verse 2','Chorus','Ending']},
    {title:'新的事將要成就',artist:'Chris Tomlin',bpm:76,key:'A',signature:'4/4',sections:['Intro','Verse','Chorus ×2','Bridge ×2','Final Chorus']}
  ];
  let songs; try { songs=JSON.parse(localStorage.getItem('syncbeat-songs'))||defaults; } catch(_){ songs=defaults; }
  let currentSong=0,currentSection=0,activeCategory='段落';
  const cueData={
    '段落':['Intro','Verse 1','Pre-Chorus','Chorus','Bridge','Ending'],
    '樂團':['All In','Keys Only','Guitar Only','Drums In','Bass In','A Cappella'],
    '動態':['Build Up','Breakdown','Hold','Tempo +5','Tempo -5'],
    '流程':['Repeat','Tag','Ending','Stop / CUT']
  };
  const directCards=()=>[...document.querySelectorAll('.app-container > .card-main,.app-container > .card-secondary')];
  function setMode(mode){
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    document.body.classList.toggle('setlist-page',mode==='worship'&&document.querySelector('.worship-tabs [data-wtab=setlist]')?.classList.contains('active'));
    directCards().forEach(n=>n.classList.toggle('mode-panel-hidden',mode==='worship'));
    el('worship-panel').classList.toggle('mode-panel-hidden',mode!=='worship');
    if(mode==='worship') renderWorship();
  }
  document.querySelectorAll('.mode-btn').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  function renderSections(target,sections,selected=-1,instructions=[]){
    target.innerHTML=sections.map((s,i)=>'<button class=\'section-chip '+(i===selected?'active':'')+'\' data-index=\''+i+'\'><b>'+safe(s)+'</b><small>'+safe(instructions[i]||(i===selected?(uiLanguage==='zh'?'目前段落':'CURRENT'):(uiLanguage==='zh'?'點擊切換':'TAP TO SWITCH')))+'</small></button>').join('');
  }
  const visibleSongIndexes=()=>songs.map((song,index)=>song.hidden?-1:index).filter(index=>index>=0);
  function adjacentVisibleSong(index,direction){const visible=visibleSongIndexes(),position=visible.indexOf(index);if(position<0)return visible[0]??index;return visible[position+direction]??index;}
  let songSwitchCountdown=null;
  function showSongSwitchCountdown(index,count){const song=songs[index],shell=document.querySelector('.live-song-shell');if(!song||!shell)return;let notice=el('song-switch-countdown');if(!notice){notice=document.createElement('aside');notice.id='song-switch-countdown';shell.appendChild(notice);}const titleSize=Math.max(9,Math.min(innerWidth<521?27:34,Math.floor(innerWidth*.82/Math.max(1,song.title.length)*.95)));notice.innerHTML='<strong>'+count+'</strong><small><span>'+(uiLanguage==='zh'?'即將切換至':'Switching to')+'</span><b style=font-size:'+titleSize+'px>'+safe(song.title)+'</b></small>';notice.classList.add('show');}
  function clearSongSwitchCountdown(){clearTimeout(songSwitchCountdown);songSwitchCountdown=null;el('song-switch-countdown')?.classList.remove('show');}
  function queueSongSwitch(index){if(sync.role==='guest'||index===currentSong||!songs[index]||songSwitchCountdown)return;if(!sync.isPlaying){selectSong(index);return;}let count=3;const step=()=>{showSongSwitchCountdown(index,count);sync.sendAppEvent({type:'SONG_COUNTDOWN',index,count});const interval=Math.max(320,Math.min(1000,60000/sync.bpm));if(count===1){songSwitchCountdown=setTimeout(()=>{clearSongSwitchCountdown();selectSong(index);},interval);return;}count-=1;songSwitchCountdown=setTimeout(step,interval);};step();}
  function selectSong(index,remote=false){
    if(sync.role==='guest'&&!remote)return;if(songs[index]?.hidden&&!remote)return;currentSong=Math.max(0,Math.min(songs.length-1,index));currentSection=0;const s=songs[currentSong];
    if(!remote){sync.sendTempo(s.bpm);const signature=(s.signature||'4/4').split('/');sync.sendTimeSignature(parseInt(signature[0],10)||4,parseInt(signature[1],10)||4);sync.sendAppEvent({type:'SONG',index:currentSong,section:0});}updateUI();renderWorship();
  }
  function renderWorship(){
    const s=songs[currentSong]||defaults[0];
    el('now-playing').innerHTML='<span class=\'song-meta\'>NOW PLAYING · '+safe(s.key)+' · '+safe(s.signature)+'</span><h2>'+safe(s.title)+'</h2><p>'+safe(s.artist)+' · '+s.bpm+' BPM</p>';
    renderSections(el('song-sections'),s.sections,currentSection,s.sectionInstructions||[]);
    el('song-sections').querySelectorAll('button').forEach(b=>b.onclick=()=>{currentSection=+b.dataset.index;renderWorship();});
    el('song-list').innerHTML=songs.map((x,i)=>'<button class=\'song-row '+(i===currentSong?'active':'')+'\' data-index=\''+i+'\'><b>'+(i+1)+'</b><span>'+x.title+'<small>'+x.artist+'</small></span><em>'+x.bpm+' BPM<br>'+x.key+'</em></button>').join('');
    el('song-list').querySelectorAll('button').forEach(b=>b.onclick=()=>selectSong(+b.dataset.index));
  }
  function showCue(text,tone=0,subtitle='Live message to the band',remote=false){
    if(sync.role==='guest'&&!remote)return;
    if(!remote)sync.sendAppEvent({type:'CUE',text,tone,subtitle});
    let banner=el('live-cue');if(!banner){banner=document.createElement('aside');banner.id='live-cue';document.body.appendChild(banner);}banner.className='live-cue tone-'+tone;clearTimeout(banner.hideTimer);banner.innerHTML='<div class=cue-megaphone>📣</div><div class=cue-copy><small>BAND CUE <i>· from '+(sync.role==='guest'?'Host':'You')+'</i></small><strong>'+safe(text)+'</strong><span>'+safe(subtitle)+'</span></div><button aria-label=Close>×</button>';banner.querySelector('button').onclick=()=>banner.classList.remove('show');requestAnimationFrame(()=>banner.classList.add('show'));banner.hideTimer=setTimeout(()=>banner.classList.remove('show'),4200);
    const scoreCue=el('score-floating-cue');if(scoreCue){clearTimeout(scoreCue.hideTimer);scoreCue.className='score-floating-cue tone-'+tone;scoreCue.innerHTML='<small>BAND CUE</small><strong>'+safe(text)+'</strong><span>'+safe(subtitle)+'</span>';requestAnimationFrame(()=>scoreCue.classList.add('show'));scoreCue.hideTimer=setTimeout(()=>scoreCue.classList.remove('show'),4200);}
    if(text.includes('+5')) changeTempo(5);if(text.includes('-5')) changeTempo(-5);
  }
  function renderCues(){
    el('cue-tabs').innerHTML=Object.keys(cueData).map(x=>'<button class=\''+(x===activeCategory?'active':'')+'\'>'+x+'</button>').join('');
    el('cue-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{activeCategory=b.textContent;renderCues();});
    const html=cueData[activeCategory].map(x=>'<button>'+safe(x)+'</button>').join('');el('cue-grid').innerHTML=html;el('worship-cues').innerHTML=cueData[Object.keys(cueData)[0]].slice(0,6).map(x=>'<button>'+safe(x)+'</button>').join('');
    document.querySelectorAll('#cue-grid button,#worship-cues button').forEach(b=>b.onclick=()=>showCue(b.textContent));
  }
  renderCues=()=>{const categories=Object.keys(cueData),icons=['◫','♫','↗','→'];if(!cueData[activeCategory])activeCategory=categories[0];el('cue-tabs').innerHTML=categories.map((x,i)=>'<button class=\''+(x===activeCategory?'active':'')+'\' data-cat=\''+safe(x)+'\'><i>'+icons[i]+'</i><span>'+safe(x)+'</span></button>').join('');el('cue-tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{activeCategory=b.dataset.cat;renderCues();});const button=(x,i)=>'<button class=\'cue-button cat-'+i+'\'><i>'+icons[i]+'</i><span>'+safe(x)+'</span><small>LIVE BROADCAST</small></button>';el('cue-grid').innerHTML=cueData[activeCategory].map(x=>button(x,categories.indexOf(activeCategory))).join('');el('worship-cues').innerHTML=cueData[categories[0]].slice(0,6).map(x=>button(x,0)).join('');document.querySelectorAll('#cue-grid button,#worship-cues button').forEach(b=>b.onclick=()=>{const tone=[...b.parentElement.children].indexOf(b)%6;showCue(b.querySelector('span').textContent,tone);});};
  var cueEdits={};try{cueEdits=JSON.parse(localStorage.getItem('syncbeat-cue-edits'))||{};}catch(_){}Object.entries(cueEdits).forEach(([key,value])=>{const split=key.lastIndexOf(':');const category=key.slice(0,split),index=+key.slice(split+1);if(cueData[category]&&value.title)cueData[category][index]=value.title;});
  renderCues=()=>{const categories=Object.keys(cueData),icons=['◫','♫','↗','→'];if(!cueData[activeCategory])activeCategory=categories[0];el('cue-tabs').innerHTML=categories.map((category,j)=>'<button class=\''+(category===activeCategory?'active':'')+'\' data-cat=\''+safe(category)+'\'><i>'+icons[j]+'</i><span>'+safe(uiLanguage==='zh'?category:['Structure','Band','Dynamics','Flow'][j])+'</span></button>').join('');el('cue-tabs').querySelectorAll('button').forEach(button=>button.onclick=()=>{activeCategory=button.dataset.cat;renderCues();});const card=(title,category,j)=>{const detail=cueEdits[category+':'+j]||{},tone=detail.tone??j%6,subtitle=detail.subtitle||(uiLanguage==='zh'?'點擊廣播':'Tap to broadcast');return '<button class=\'cue-button tone-'+tone+'\'><i>'+icons[categories.indexOf(category)]+'</i><span>'+safe(title)+'</span><small>'+safe(subtitle)+'</small></button>';};el('cue-grid').innerHTML=cueData[activeCategory].map((title,j)=>card(title,activeCategory,j)).join('');const first=categories[0];el('worship-cues').innerHTML=cueData[first].slice(0,6).map((title,j)=>card(title,first,j)).join('');};
  renderSections(el('practice-sections'),defaults[0].sections);renderCues();renderWorship();
  document.addEventListener('click',event=>{const button=event.target.closest('#cue-grid .cue-button,#worship-cues .cue-button');if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(button.dataset.longPress==='1'){button.dataset.longPress='0';return;}const index=[...button.parentElement.children].indexOf(button),tone=index%6,category=button.closest('#worship-cues')?Object.keys(cueData)[0]:activeCategory,detail=cueEdits[category+':'+index]||{};showCue(button.querySelector('span').textContent,detail.tone??tone,detail.subtitle||'Live message to the band');},{capture:true});
  let cueHoldTimer=null;document.addEventListener('pointerdown',event=>{const button=event.target.closest('#cue-grid .cue-button,#worship-cues .cue-button');if(!button)return;cueHoldTimer=setTimeout(()=>{button.dataset.longPress='1';const index=[...button.parentElement.children].indexOf(button),category=button.closest('#worship-cues')?Object.keys(cueData)[0]:activeCategory;editCue(category,index);navigator.vibrate&&navigator.vibrate(35);},560);},{capture:true});document.addEventListener('pointerup',()=>clearTimeout(cueHoldTimer),{capture:true});document.addEventListener('pointercancel',()=>clearTimeout(cueHoldTimer),{capture:true});
  el('prev-song').onclick=()=>queueSongSwitch(adjacentVisibleSong(currentSong,-1));el('next-song').onclick=()=>queueSongSwitch(adjacentVisibleSong(currentSong,1));
  el('worship-play').onclick=()=>btnPlay.click();el('advance-section').onclick=()=>{if(sync.role==='guest')return;const song=songs[currentSong];if(currentSection>=song.sections.length-1)return;const nextIndex=currentSection+1,nextTitle=song.sections[nextIndex];currentSection=nextIndex;sync.sendAppEvent({type:'SECTION',index:currentSong,section:currentSection});renderWorship();showCue(nextTitle,0,(song.sectionInstructions||[])[nextIndex]||('Next section · '+song.title));};
  el('load-song').onclick=()=>{const s=songs[currentSong];renderSections(el('practice-sections'),s.sections);showCue((uiLanguage==='zh'?'已載入：':'Loaded: ')+s.title);};
  el('send-custom-cue').onclick=()=>{const input=el('custom-cue');if(input.value.trim()){showCue(input.value.trim());input.value='';}};
  const scorePanel=document.querySelector('.score-panel'),scoreViewer=el('score-viewer'),scoreFullscreen=el('score-fullscreen');
  const personalScoreNote=document.createElement('input');personalScoreNote.id='score-personal-note';personalScoreNote.maxLength=100;personalScoreNote.placeholder=uiLanguage==='zh'?'我的筆記…':'My note…';scoreFullscreen.insertAdjacentElement('beforebegin',personalScoreNote);
  let personalScoreNotes={};try{personalScoreNotes=JSON.parse(localStorage.getItem('syncbeat-personal-score-notes'))||{};}catch(_){}
  function currentViewedScoreSheet(){const sheets=[...scoreViewer.querySelectorAll('.score-song-sheet')],center=scoreViewer.scrollLeft+scoreViewer.clientWidth*.5;let sheet=sheets[0];for(const item of sheets)if(item.offsetLeft<=center)sheet=item;return sheet;}
  function refreshPersonalScoreNote(){const sheet=currentViewedScoreSheet();if(!sheet)return;const key=sync.deviceId+':'+sheet.dataset.songId;personalScoreNote.dataset.noteKey=key;personalScoreNote.value=personalScoreNotes[key]||'';personalScoreNote.title=(uiLanguage==='zh'?'我的筆記 · ':'My note · ')+sheet.dataset.songTitle;}
  personalScoreNote.addEventListener('pointerdown',event=>{if(personalScoreNote.readOnly)event.preventDefault();});personalScoreNote.oninput=()=>{const key=personalScoreNote.dataset.noteKey;if(!key)return;personalScoreNotes[key]=personalScoreNote.value;localStorage.setItem('syncbeat-personal-score-notes',JSON.stringify(personalScoreNotes));};
  const doodleButton=document.createElement('button');doodleButton.id='score-doodle';doodleButton.type='button';doodleButton.title='Doodle';doodleButton.textContent='✎';scoreFullscreen.insertAdjacentElement('beforebegin',doodleButton);
  const scoreHud=scorePanel.querySelector('.score-hud'),scoreHudActions=document.createElement('div'),scoreHudLower=document.createElement('div'),scorePageNumber=document.createElement('small');scoreHudActions.className='score-hud-actions';scoreHudLower.className='score-hud-lower';scorePageNumber.id='score-page-number';scorePageNumber.textContent='1 / 1';scoreHudLower.append(scorePageNumber,scorePanel.querySelector('.score-live-beat'),doodleButton,scoreFullscreen);scoreHudActions.append(personalScoreNote,scoreHudLower);scoreHud.append(scoreHudActions);
  const doodleCanvas=document.createElement('canvas');doodleCanvas.id='score-doodle-canvas';scorePanel.appendChild(doodleCanvas);
  const doodleTools=document.createElement('div');doodleTools.id='score-doodle-tools';doodleTools.innerHTML='<button data-doodle=draw title=Draw>✎</button><button data-doodle=erase title=Erase>⌫</button><input type=color value=#ef4444 aria-label=Doodle-color><button data-doodle=clear>Clear</button><button data-doodle=done>Done</button>';scorePanel.appendChild(doodleTools);
  let doodleMode=false,doodleDrawing=false,doodleStroke=null,doodleTool='draw',doodles={};try{doodles=JSON.parse(localStorage.getItem('syncbeat-score-doodles'))||{};}catch(_){}
  const viewedScoreSheet=()=>{const sheets=[...scoreViewer.querySelectorAll('.score-song-sheet')],center=scoreViewer.scrollLeft+scoreViewer.clientWidth*.5;let sheet=sheets[0];for(const item of sheets)if(item.offsetLeft<=center)sheet=item;return sheet;};
  const doodleKey=()=>{const sheet=viewedScoreSheet();return sheet?sheet.dataset.songId+':'+sheet.dataset.page:null;};
  function sizeDoodle(){const vr=scoreViewer.getBoundingClientRect(),pr=scorePanel.getBoundingClientRect(),ratio=devicePixelRatio||1;doodleCanvas.style.left=(vr.left-pr.left)+'px';doodleCanvas.style.top=(vr.top-pr.top)+'px';doodleCanvas.style.width=vr.width+'px';doodleCanvas.style.height=vr.height+'px';doodleCanvas.width=Math.max(1,Math.round(vr.width*ratio));doodleCanvas.height=Math.max(1,Math.round(vr.height*ratio));drawDoodles();}
  function drawDoodles(){const context=doodleCanvas.getContext('2d'),ratio=devicePixelRatio||1,key=doodleKey();context.clearRect(0,0,doodleCanvas.width,doodleCanvas.height);context.lineCap='round';context.lineJoin='round';for(const stroke of (key&&doodles[key]||[])){context.beginPath();context.strokeStyle=stroke.color;context.lineWidth=3*ratio;stroke.points.forEach((point,index)=>{const x=point[0]*doodleCanvas.width,y=point[1]*doodleCanvas.height;index?context.lineTo(x,y):context.moveTo(x,y);});context.stroke();}}
  function finishDoodleStroke(){if(!doodleStroke){doodleDrawing=false;return;}const key=doodleKey();if(key){(doodles[key]||(doodles[key]=[])).push(doodleStroke);localStorage.setItem('syncbeat-score-doodles',JSON.stringify(doodles));}doodleStroke=null;doodleDrawing=false;drawDoodles();}
  function eraseDoodleAt(event){const key=doodleKey();if(!key||!doodles[key])return;const rect=doodleCanvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height,radius=22/Math.max(rect.width,rect.height),result=[];for(const stroke of doodles[key]){let segment=[];for(const point of stroke.points){if(Math.hypot(point[0]-x,point[1]-y)<=radius){if(segment.length>1)result.push({color:stroke.color,points:segment});segment=[];}else segment.push(point);}if(segment.length>1)result.push({color:stroke.color,points:segment});}doodles[key]=result;localStorage.setItem('syncbeat-score-doodles',JSON.stringify(doodles));drawDoodles();}
  doodleCanvas.onpointerdown=event=>{if(!doodleMode||zoomGesturing)return;doodleDrawing=true;doodleCanvas.setPointerCapture?.(event.pointerId);if(doodleTool==='erase'){eraseDoodleAt(event);return;}doodleStroke={color:doodleTools.querySelector('input').value,points:[]};doodleCanvas.onpointermove(event);};
  doodleCanvas.onpointermove=event=>{if(zoomGesturing||!doodleDrawing)return;if(doodleTool==='erase'){eraseDoodleAt(event);return;}if(!doodleStroke)return;const rect=doodleCanvas.getBoundingClientRect();doodleStroke.points.push([(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height]);drawDoodles();const context=doodleCanvas.getContext('2d'),ratio=devicePixelRatio||1,points=doodleStroke.points;context.beginPath();context.strokeStyle=doodleStroke.color;context.lineWidth=3*ratio;points.forEach((point,index)=>{const x=point[0]*doodleCanvas.width,y=point[1]*doodleCanvas.height;index?context.lineTo(x,y):context.moveTo(x,y);});context.stroke();};
  doodleCanvas.onpointerup=finishDoodleStroke;doodleCanvas.onpointercancel=finishDoodleStroke;
  function setDoodleMode(active){doodleMode=active;scorePanel.classList.toggle('doodle-active',active);doodleButton.classList.toggle('active',active);if(active)sizeDoodle();}
  doodleButton.onclick=()=>setDoodleMode(!doodleMode);doodleTools.querySelector('[data-doodle=draw]').onclick=()=>{doodleTool='draw';doodleTools.dataset.tool='draw';};doodleTools.querySelector('[data-doodle=erase]').onclick=()=>{doodleTool='erase';doodleTools.dataset.tool='erase';};doodleTools.querySelector('[data-doodle=done]').onclick=()=>setDoodleMode(false);doodleTools.querySelector('[data-doodle=clear]').onclick=()=>{const key=doodleKey();if(key){delete doodles[key];localStorage.setItem('syncbeat-score-doodles',JSON.stringify(doodles));drawDoodles();}};doodleTools.dataset.tool='draw';requestAnimationFrame(sizeDoodle);
  function setFullscreenScoreEditingState(){const fullscreen=!!document.fullscreenElement||scorePanel.classList.contains('score-fullscreen-fallback');if(fullscreen&&doodleMode)setDoodleMode(false);personalScoreNote.readOnly=fullscreen;personalScoreNote.tabIndex=fullscreen?-1:0;personalScoreNote.setAttribute('aria-readonly',String(fullscreen));doodleButton.disabled=fullscreen;scorePanel.classList.toggle('score-reading-only',fullscreen);setTimeout(sizeDoodle,60);}
  scoreViewer.addEventListener('scroll',()=>requestAnimationFrame(sizeDoodle));new MutationObserver(()=>requestAnimationFrame(sizeDoodle)).observe(scoreViewer,{childList:true});window.addEventListener('resize',sizeDoodle);document.addEventListener('fullscreenchange',setFullscreenScoreEditingState);
  let scoreZoom=1,scorePanX=0,scorePanY=0,zoomGesturing=false,zoomSheetKey='',pinchStart=null,panStart=null,edgePageSwipe=0;const zoomPointers=new Map();
  function applyScoreZoom(){const sheet=viewedScoreSheet(),key=doodleKey()||'';scoreViewer.querySelectorAll('.score-pages').forEach(page=>page.style.transform='');if(sheet){sheet.querySelector('.score-pages').style.transform='translate('+scorePanX+'px,'+scorePanY+'px) scale('+scoreZoom+')';}doodleCanvas.style.transform='translate('+scorePanX+'px,'+scorePanY+'px) scale('+scoreZoom+')';scorePanel.classList.toggle('score-zoomed',scoreZoom>1.01);zoomSheetKey=key;}
  function resetScoreZoom(){scoreZoom=1;scorePanX=0;scorePanY=0;applyScoreZoom();}
  function pointerDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}function pointerMid(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  scorePanel.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;zoomPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(zoomPointers.size===2){zoomGesturing=true;edgePageSwipe=0;finishDoodleStroke();const points=[...zoomPointers.values()],mid=pointerMid(points[0],points[1]);pinchStart={distance:pointerDistance(points[0],points[1]),scale:scoreZoom,x:scorePanX,y:scorePanY,mid};}else if(scoreZoom>1.01&&!doodleMode){edgePageSwipe=0;panStart={x:event.clientX,y:event.clientY,panX:scorePanX,panY:scorePanY};}},{capture:true});
  scorePanel.addEventListener('pointermove',event=>{if(!zoomPointers.has(event.pointerId))return;zoomPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(zoomPointers.size===2&&pinchStart){event.preventDefault();const points=[...zoomPointers.values()],mid=pointerMid(points[0],points[1]),next=Math.max(1,Math.min(4,pinchStart.scale*pointerDistance(points[0],points[1])/Math.max(1,pinchStart.distance)));scoreZoom=next;scorePanX=next===1?0:pinchStart.x+(mid.x-pinchStart.mid.x);scorePanY=next===1?0:pinchStart.y+(mid.y-pinchStart.mid.y);applyScoreZoom();}else if(panStart&&scoreZoom>1.01&&!doodleMode){event.preventDefault();const width=scoreViewer.clientWidth,height=scoreViewer.clientHeight,maxX=(scoreZoom-1)*width/2,maxY=(scoreZoom-1)*height/2,rawX=panStart.panX+event.clientX-panStart.x,rawY=panStart.panY+event.clientY-panStart.y;edgePageSwipe=rawX < -maxX-55?1:rawX > maxX+55?-1:0;scorePanX=Math.max(-maxX-18,Math.min(maxX+18,rawX));scorePanY=Math.max(-maxY,Math.min(maxY,rawY));applyScoreZoom();}},{capture:true});
  const endZoomPointer=event=>{zoomPointers.delete(event.pointerId);if(zoomPointers.size<2){zoomGesturing=false;pinchStart=null;}if(!zoomPointers.size){panStart=null;if(edgePageSwipe){const direction=edgePageSwipe;edgePageSwipe=0;resetScoreZoom();scoreViewer.scrollTo({left:scoreViewer.scrollLeft+direction*scoreViewer.clientWidth,behavior:'smooth'});}}};scorePanel.addEventListener('pointerup',endZoomPointer,{capture:true});scorePanel.addEventListener('pointercancel',endZoomPointer,{capture:true});
  scoreViewer.addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();scoreZoom=Math.max(1,Math.min(4,scoreZoom*(event.deltaY<0?1.12:.89)));if(scoreZoom===1){scorePanX=0;scorePanY=0;}applyScoreZoom();},{passive:false});
  scoreViewer.addEventListener('dblclick',resetScoreZoom);
  let zoomScrollTimer=null;scoreViewer.addEventListener('scroll',()=>{clearTimeout(zoomScrollTimer);zoomScrollTimer=setTimeout(()=>{const key=doodleKey()||'';if(key!==zoomSheetKey)resetScoreZoom();else applyScoreZoom();},90);});
  el('add-song').onclick=()=>{const title=prompt(uiLanguage==='zh'?'歌曲名稱':'Song title');if(!title)return;const bpm=Math.max(20,Math.min(300,parseInt(prompt('BPM','120'),10)||120));songs.push({title,artist:'',bpm,key:'C',signature:'4/4',sections:['Intro','Verse','Chorus','Ending']});localStorage.setItem('syncbeat-songs',JSON.stringify(songs));selectSong(songs.length-1);};

  // Full worship setlist management and Android-style sub-navigation.
  songs=songs.map((s,i)=>Object.assign({id:'song_'+i,artist:'',key:'C',signature:'4/4',capo:'',notes:'',youtubeUrl:'',lyrics:'',hidden:false},s));
  let setlist;try{setlist=JSON.parse(localStorage.getItem('syncbeat-setlist-info'))||{};}catch(_){setlist={};}
  setlist=Object.assign({name:'主日敬拜',serviceDate:new Date().toLocaleDateString('zh-TW'),leader:'',vocals:'',musicians:'',notes:''},setlist);
  let library;try{library=JSON.parse(localStorage.getItem('syncbeat-library'))||[];}catch(_){library=[];}
  function persist(){localStorage.setItem('syncbeat-songs',JSON.stringify(songs));localStorage.setItem('syncbeat-setlist-info',JSON.stringify(setlist));localStorage.setItem('syncbeat-library',JSON.stringify(library));}  let scoreObjectUrl='',loadedScoreId='',scoreUploadTarget=null;
  const scoreDb=new Promise((resolve,reject)=>{const request=indexedDB.open('syncbeat-scores',1);request.onupgradeneeded=()=>request.result.createObjectStore('scores');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  async function saveSongScore(song,files){const entries=await Promise.all([...files].map(async file=>({data:await file.arrayBuffer(),name:file.name,type:file.type}))),db=await scoreDb;await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').put({files:entries},song.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});song.scoreName=entries.map(x=>x.name).join(', ');song.scorePages=entries.length;persist();loadedScoreId='';await loadScoreForSong(song);}
  async function deleteSongScore(song){const db=await scoreDb;await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').delete(song.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});song.scoreName='';song.scorePages=0;loadedScoreId='';persist();await loadScoreForSong(song);}
  async function loadScoreForSong(song){if(!song)return;const liveTitle=el('score-song-title');if(liveTitle)liveTitle.textContent=(uiLanguage==='zh'?'現場：':'LIVE: ')+song.title;const signature=songs.map(item=>item.id+':'+(item.scoreName||'')).join('|');if(loadedScoreId===signature){updateScoreReadingWarning();return;}loadedScoreId=signature;const viewer=el('score-viewer');if(!viewer)return;scoreObjectUrl.split('|').filter(Boolean).forEach(url=>URL.revokeObjectURL(url));const db=await scoreDb,urls=[],pages=[];for(let songIndex=0;songIndex<songs.length;songIndex++){const item=songs[songIndex],record=await new Promise((resolve,reject)=>{const request=db.transaction('scores').objectStore('scores').get(item.id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}),entries=record?(record.files||[record]):[];if(!entries.length)pages.push(scorePage(item,songIndex,'<p>'+(uiLanguage==='zh'?'尚未上傳譜面':'No score uploaded')+'</p>',1,1));entries.forEach((entry,index)=>{const url=URL.createObjectURL(entry.blob||new Blob([entry.data],{type:entry.type}));urls.push(url);const content=entry.type==='application/pdf'?'<iframe title="'+safe(item.title)+' score '+(index+1)+'" src="'+url+'#toolbar=0"></iframe>':'<img alt="'+safe(item.title)+' score '+(index+1)+'" src="'+url+'">';pages.push(scorePage(item,songIndex,content,index+1,entries.length));});}scoreObjectUrl=urls.join('|');viewer.innerHTML=pages.join('');viewer.onscroll=updateScoreReadingWarning;updateScoreReadingWarning();}
  function scorePage(item,songIndex,content,page,total){return '<section class="score-song-sheet" data-song-id="'+safe(item.id)+'" data-song-title="'+safe(item.title)+'" data-song-number="'+(songIndex+1)+'" data-page="'+page+'" data-total="'+total+'"><div class="score-pages">'+content+'</div></section>';}
    function updateScoreReadingWarning(){const viewer=el('score-viewer'),warning=el('score-view-warning'),live=songs[currentSong];if(!viewer||!warning||!live)return;const sheets=[...viewer.querySelectorAll('.score-song-sheet')],center=viewer.scrollLeft+viewer.clientWidth*.5;let viewed=sheets[0];for(const sheet of sheets)if(sheet.offsetLeft<=center)viewed=sheet;const title=el('score-song-title');let pageNumber=el('score-page-number');if(title&&!pageNumber){pageNumber=document.createElement('small');pageNumber.id='score-page-number';title.insertAdjacentElement('afterend',pageNumber);}if(viewed&&title)title.textContent=viewed.dataset.songNumber+'. '+viewed.dataset.songTitle;if(viewed&&pageNumber)pageNumber.textContent=viewed.dataset.page+' / '+viewed.dataset.total;refreshPersonalScoreNote();if(!viewed||viewed.dataset.songId===live.id){warning.classList.remove('show');return;}warning.textContent=(uiLanguage==='zh'?'正在查看：':'Viewing: ')+viewed.dataset.songTitle+' · '+(uiLanguage==='zh'?'現場 Beat：':'Live beat: ')+live.title;warning.classList.add('show');}
      const blobToDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  function dataUrlToBlob(dataUrl){const [meta,data]=dataUrl.split(','),mime=(meta.match(/data:(.*?);/)||[])[1]||'application/octet-stream',bytes=atob(data),array=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);return new Blob([array],{type:mime});}
  async function createBandPack(){const db=await scoreDb,packedScores={};for(const song of songs){const record=await new Promise((resolve,reject)=>{const request=db.transaction('scores').objectStore('scores').get(song.id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});if(record){const entries=record.files||[record];packedScores[song.id]=await Promise.all(entries.map(async entry=>({name:entry.name||'score',type:entry.type||(entry.blob&&entry.blob.type)||'application/octet-stream',data:await blobToDataUrl(entry.blob||new Blob([entry.data],{type:entry.type}))})));}}return {format:'syncbeat-band-pack',version:1,exportedAt:new Date().toISOString(),setlist,songs,scores:packedScores};}
  async function importBandPack(pack){if(!pack||!Array.isArray(pack.songs))throw new Error('Invalid Band Pack');songs=pack.songs;setlist=Object.assign(setlist,pack.setlist||{});const converted={};for(const [songId,entries] of Object.entries(pack.scores||{}))converted[songId]=await Promise.all(entries.map(async entry=>({name:entry.name,type:entry.type,data:await dataUrlToBlob(entry.data).arrayBuffer()})));const db=await scoreDb,tx=db.transaction('scores','readwrite'),store=tx.objectStore('scores');for(const [songId,entries] of Object.entries(converted))store.put({files:entries},songId);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});currentSong=0;loadedScoreId='';persist();renderWorshipFull();}  function safe(value){const node=document.createElement('span');node.textContent=value==null?'':value;return node.innerHTML;}
  function openDialog(title,body,onSave,saveLabel='儲存'){
    let d=el('app-dialog');if(d)d.remove();d=document.createElement('dialog');d.id='app-dialog';d.className='app-dialog';
    d.innerHTML='<form method=dialog><header><h2>'+safe(title)+'</h2><button value=cancel>×</button></header>'+body+'<menu><button value=cancel>'+(uiLanguage==='zh'?'取消':'Cancel')+'</button><button class=primary value=default>'+safe(saveLabel)+'</button></menu></form>';
    document.body.appendChild(d);const songTitle=d.querySelector('[data-field=title]'),youtube=d.querySelector('[data-field=youtubeUrl]');if(songTitle&&youtube){const search=document.createElement('button');search.type='button';search.className='youtube-search';search.innerHTML='▶ Search YouTube by song title';search.onclick=()=>{const query=songTitle.value.trim();if(!query){songTitle.focus();return;}const url='https://www.youtube.com/results?search_query='+encodeURIComponent(query);youtube.value=url;youtube.dispatchEvent(new Event('input',{bubbles:true}));};youtube.insertAdjacentElement('afterend',search);}d.querySelector('form').addEventListener('submit',e=>{if(e.submitter&&e.submitter.value==='default'){e.preventDefault();if(onSave(d)!==false)d.close();}});d.addEventListener('close',()=>d.remove());d.showModal();return d;
  }
  function editCue(category,index){const detail=cueEdits[category+':'+index]||{},title=detail.title||cueData[category][index],body=field('Cue title','cueTitle',title)+'<label>Subtitle / musician instruction</label><input data-field=cueSubtitle value=\''+safe(detail.subtitle||'')+'\'><label>Card and alert color</label><select data-field=cueTone><option value=0>Blue</option><option value=1>Green</option><option value=2>Amber</option><option value=3>Purple</option><option value=4>Rose</option><option value=5>Indigo</option></select>';const d=openDialog('Edit Live Stage Cue',body,x=>{const value={title:x.querySelector('[data-field=cueTitle]').value.trim()||title,subtitle:x.querySelector('[data-field=cueSubtitle]').value.trim(),tone:+x.querySelector('[data-field=cueTone]').value};cueEdits[category+':'+index]=value;cueData[category][index]=value.title;localStorage.setItem('syncbeat-cue-edits',JSON.stringify(cueEdits));renderCues();});d.querySelector('[data-field=cueTone]').value=String(detail.tone??index%6);}
  function field(label,name,value='',type='text'){return '<label>'+label+'</label><input data-field='+name+' type='+type+' value=\''+safe(value)+'\'>';}
  function editSong(index){const adding=index==null,s=adding?{title:'',artist:'',bpm:120,key:'C',signature:'4/4',capo:'',notes:'',youtubeUrl:'',sections:['Intro','Verse','Chorus','Ending']}:songs[index];
    const body='<div class=\'field-grid song-editor-fields\'>'+ field('Song title','title',s.title)+field('Artist','artist',s.artist)+field('BPM','bpm',s.bpm,'number')+field('Key','key',s.key)+field('Time signature','signature',s.signature)+field('Capo','capo',s.capo)+field('YouTube URL','youtubeUrl',s.youtubeUrl)+'</div><label>'+(uiLanguage==='zh'?'歌曲段落/樂手提示（每行一段）':'Song section/musician instruction (one per line)')+'</label><textarea data-field=sections rows=6 maxlength=1600 placeholder="'+(uiLanguage==='zh'?'例如：Verse 1/鼓輕一點':'Example: Verse 1/Drums light')+'">'+safe(s.sections.map((section,i)=>section+((s.sectionInstructions||[])[i]?'/'+s.sectionInstructions[i]:'')).join('\n'))+'</textarea><label>Notes</label><textarea data-field=notes rows=3 maxlength=500>'+safe(s.notes||'')+'</textarea><p class=song-form-error role=alert aria-live=polite></p>';
    const d=openDialog(adding?(uiLanguage==='zh'?'新增歌曲':'Add Song'):(uiLanguage==='zh'?'編輯歌曲':'Edit Song'),body,d=>{const get=n=>d.querySelector('[data-field='+n+']').value.trim(),fail=(fieldName,message)=>{const input=d.querySelector('[data-field='+fieldName+']'),error=d.querySelector('.song-form-error');d.querySelectorAll('.field-invalid').forEach(node=>node.classList.remove('field-invalid'));if(input){input.classList.add('field-invalid');input.focus();}error.textContent=message;return false;},title=get('title'),artist=get('artist'),bpmText=get('bpm'),key=get('key'),signature=get('signature'),capo=get('capo'),youtubeUrl=get('youtubeUrl'),notes=get('notes'),sectionRows=get('sections').split(/\n/).map(x=>x.trim()).filter(Boolean),sections=sectionRows.map(row=>row.split('/')[0].trim()),sectionInstructions=sectionRows.map(row=>row.includes('/')?row.slice(row.indexOf('/')+1).trim():'');if(!title)return fail('title',uiLanguage==='zh'?'請輸入歌曲名稱。':'Song title is required.');if(title.length>80)return fail('title',uiLanguage==='zh'?'歌曲名稱最多 80 個字元。':'Song title must be 80 characters or fewer.');if(artist.length>80)return fail('artist',uiLanguage==='zh'?'歌手名稱最多 80 個字元。':'Artist must be 80 characters or fewer.');if(!/^\d+$/.test(bpmText)||+bpmText<20||+bpmText>300)return fail('bpm',uiLanguage==='zh'?'BPM 必須是 20 到 300 的整數。':'BPM must be a whole number from 20 to 300.');if(!/^[A-Ga-g](?:#|b)?m?$/.test(key))return fail('key',uiLanguage==='zh'?'Key 請輸入 C、F#、Bb、Em 等格式。':'Use a key such as C, F#, Bb, or Em.');const signatureMatch=signature.match(/^(\d{1,2})\/(1|2|4|8|16|32)$/);if(!signatureMatch||+signatureMatch[1]<1||+signatureMatch[1]>32)return fail('signature',uiLanguage==='zh'?'拍號請使用 4/4、6/8 等格式；每小節 1–32 拍。':'Use a time signature such as 4/4 or 6/8, with 1–32 beats.');if(capo&&!/^(?:[0-9]|1[0-2])$/.test(capo))return fail('capo',uiLanguage==='zh'?'Capo 只能輸入 0 到 12，或留白。':'Capo must be from 0 to 12, or left blank.');if(youtubeUrl){try{const url=new URL(youtubeUrl);if(!/^https?:$/.test(url.protocol)||!/(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname))return fail('youtubeUrl',uiLanguage==='zh'?'請輸入有效的 YouTube 或 youtu.be 網址。':'Enter a valid YouTube or youtu.be URL.');}catch(_){return fail('youtubeUrl',uiLanguage==='zh'?'YouTube 網址格式不正確。':'The YouTube URL is not valid.');}}if(!sections.length||sections.some(section=>!section))return fail('sections',uiLanguage==='zh'?'請為每一行輸入歌曲段落名稱。':'Enter a section name on every line.');if(sectionInstructions.some(instruction=>instruction.length>100))return fail('sections',uiLanguage==='zh'?'每個樂手提示最多 100 個字元。':'Each musician instruction must be 100 characters or fewer.');if(sections.length>40)return fail('sections',uiLanguage==='zh'?'歌曲段落最多 40 個。':'A song can have at most 40 sections.');if(sections.some(section=>section.length>60))return fail('sections',uiLanguage==='zh'?'每個歌曲段落最多 60 個字元。':'Each song section must be 60 characters or fewer.');const updated=Object.assign({},s,{id:s.id||'song_'+Date.now(),title,artist,bpm:+bpmText,key:key[0].toUpperCase()+key.slice(1),signature,capo,youtubeUrl,notes,sections,sectionInstructions});if(adding){songs.push(updated);currentSong=songs.length-1;}else songs[index]=updated;persist();renderWorship();});
    const limits={title:80,artist:80,bpm:3,key:4,signature:5,capo:2,youtubeUrl:300};Object.entries(limits).forEach(([name,max])=>{const input=d.querySelector('[data-field='+name+']');if(input)input.maxLength=max;});d.querySelector('[data-field=bpm]').min='20';d.querySelector('[data-field=bpm]').max='300';d.querySelectorAll('input,textarea').forEach(input=>input.addEventListener('input',()=>{input.classList.remove('field-invalid');const error=d.querySelector('.song-form-error');if(error)error.textContent='';}));
  }
  function editSetlist(){const body='<div class=setlist-editor><label>SETLIST TITLE</label><div class=icon-field><i>♪</i><input data-field=name value=\''+safe(setlist.name)+'\'></div><label>SERVICE & DATE</label><div class=icon-field><i>▣</i><input data-field=serviceDate value=\''+safe(setlist.serviceDate)+'\' placeholder=\'2026-08-22 Sunday Worship\'></div><label>WORSHIP LEADER</label><div class=icon-field><i>●</i><input data-field=leader value=\''+safe(setlist.leader)+'\'></div><label>VOCALS</label><div class=icon-field><i>♫</i><input data-field=vocals value=\''+safe(setlist.vocals)+'\'></div><label>MUSICIANS & BAND <small>Tap below to add a role</small></label><textarea data-field=musicians rows=3>'+safe(setlist.musicians)+'</textarea><div class=role-chips><button type=button data-role=KB>KB</button><button type=button data-role=Acoustic>Acoustic</button><button type=button data-role=Electric>Electric</button><button type=button data-role=Drums>Drums</button><button type=button data-role=Bass>Bass</button><button type=button data-role=Strings>Strings</button><button type=button data-role=Sound>Sound</button></div><label>SETLIST NOTES</label><textarea data-field=notes rows=4 placeholder=\'Opening, transitions, ending and band notes\'>'+safe(setlist.notes)+'</textarea></div>';
    const d=openDialog(uiLanguage==='zh'?'樂團資訊':'Band Info',body,x=>{['name','serviceDate','leader','vocals','musicians','notes'].forEach(n=>setlist[n]=x.querySelector('[data-field='+n+']').value.trim());persist();renderWorship();showCue(uiLanguage==='zh'?'樂團資訊已更新':'Band info updated',2,uiLanguage==='zh'?'已儲存並可同步給樂團':'Saved and ready to sync with the band');},uiLanguage==='zh'?'儲存並廣播':'Save & Broadcast');d.querySelectorAll('[data-role]').forEach(button=>button.onclick=()=>{const input=d.querySelector('[data-field=musicians]'),role=button.dataset.role+': ';if(!input.value.includes(role))input.value+=(input.value.trim()?' | ':'')+role;input.focus();});}
  function bindSongReorder(){const list=el('song-list');let held=null,ghost=null,timer=null,currentId=null,startX=0,startY=0,lastX=0,lastY=0,offsetX=0,offsetY=0;const rows=()=>[...list.querySelectorAll('.song-row')];rows().forEach(row=>{row.oncontextmenu=event=>event.preventDefault();row.onpointerdown=event=>{if(sync.role==='guest'||event.target.closest('button'))return;clearTimeout(timer);startX=lastX=event.clientX;startY=lastY=event.clientY;timer=setTimeout(()=>{held=row;row.setPointerCapture?.(event.pointerId);currentId=songs[currentSong]&&songs[currentSong].id;const rect=row.getBoundingClientRect();offsetX=lastX-rect.left;offsetY=lastY-rect.top;ghost=row.cloneNode(true);ghost.className='song-row drag-ghost';ghost.style.cssText+=';left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px';document.body.appendChild(ghost);row.classList.add('drag-placeholder');document.body.classList.add('reorder-active');navigator.vibrate&&navigator.vibrate(35);},event.target.closest('.drag-handle')?160:430);};});document.onpointermove=event=>{lastX=event.clientX;lastY=event.clientY;if(!held){if(Math.hypot(lastX-startX,lastY-startY)>18)clearTimeout(timer);return;}event.preventDefault();ghost.style.left=(event.clientX-offsetX)+'px';ghost.style.top=(event.clientY-offsetY)+'px';const edge=70,scrollHost=list.scrollHeight>list.clientHeight?list:null;if(event.clientY<edge){if(scrollHost)scrollHost.scrollTop-=10;else window.scrollBy(0,-10);}else if(event.clientY>innerHeight-edge){if(scrollHost)scrollHost.scrollTop+=10;else window.scrollBy(0,10);}const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.song-row');if(!target||target===held||target===ghost||target.parentElement!==list)return;const before=new Map(rows().map(row=>[row,row.getBoundingClientRect()])),rect=target.getBoundingClientRect();list.insertBefore(held,event.clientY<rect.top+rect.height/2?target:target.nextSibling);rows().forEach(row=>{if(row===held)return;const old=before.get(row),now=row.getBoundingClientRect();if(old&&(old.left!==now.left||old.top!==now.top))row.animate([{transform:'translate('+(old.left-now.left)+'px,'+(old.top-now.top)+'px)'},{transform:'translate(0,0)'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});});};const finish=()=>{clearTimeout(timer);document.body.classList.remove('reorder-active');if(!held)return;if(ghost)ghost.remove();held.classList.remove('drag-placeholder');const order=rows().map(row=>row.dataset.songId),byId=new Map(songs.map(song=>[song.id,song]));songs=order.map(id=>byId.get(id)).filter(Boolean);currentSong=Math.max(0,songs.findIndex(song=>song.id===currentId));held=null;ghost=null;persist();renderWorshipFull();};document.onpointerup=finish;document.onpointercancel=finish;}
  function renderWorshipFull(){const visible=visibleSongIndexes();if(!visible.length)return;if(songs[currentSong]?.hidden)currentSong=visible[0];const s=songs[currentSong]||songs[visible[0]];if(!s)return;el('now-playing').dataset.prev=songs[adjacentVisibleSong(currentSong,-1)].title;el('now-playing').dataset.next=songs[adjacentVisibleSong(currentSong,1)].title;if(el('setlist-name'))el('setlist-name').textContent=setlist.name;el('setlist-info').innerHTML='<strong class=setlist-date>'+safe(setlist.serviceDate||setlist.name)+'</strong><div class=setlist-voices><span>'+(uiLanguage==='zh'?'主領：':'Leader: ')+safe(setlist.leader||(uiLanguage==='zh'?'未設定':'Not set'))+'</span><span>'+(uiLanguage==='zh'?'和聲：':'Vocals: ')+safe(setlist.vocals||(uiLanguage==='zh'?'未設定':'Not set'))+'</span></div><div class=setlist-musicians>'+safe(setlist.musicians||(uiLanguage==='zh'?'尚未設定樂手':'No musicians set'))+'</div>';
    if(el('mode-song-count'))el('mode-song-count').textContent=songs.length;if(el('setlist-count'))el('setlist-count').textContent=songs.length;
    el('now-playing').innerHTML='<div class=song-badges><b>SONG '+(currentSong+1)+'/'+songs.length+'</b><span>Key: '+safe(s.key)+'</span><span>'+safe(s.signature)+'</span></div><h2>'+safe(s.title)+'</h2><p>'+(uiLanguage==='zh'?'左右滑動切換歌曲':'Swipe to switch songs')+'</p>'+(s.lyrics?'<details><summary>Show Chords & Lyrics</summary><pre>'+safe(s.lyrics)+'</pre></details>':'');const active=s.sections[currentSection]||s.sections[0],hasNextSection=currentSection<s.sections.length-1,next=hasNextSection?s.sections[currentSection+1]:(uiLanguage==='zh'?'歌曲結束':'End of song');if(el('current-section-card'))el('current-section-card').innerHTML='<small>'+(uiLanguage==='zh'?'目前':'NOW')+'</small><b>'+safe(active)+'</b>';if(el('next-section-card'))el('next-section-card').innerHTML='<small>'+(hasNextSection?(uiLanguage==='zh'?'下一段':'NEXT SECTION'):(uiLanguage==='zh'?'已完成':'COMPLETE'))+'</small><b>'+safe(next)+'</b>';const advanceButton=el('advance-section');if(advanceButton){advanceButton.disabled=!hasNextSection||sync.role==='guest';advanceButton.textContent=hasNextSection?(uiLanguage==='zh'?'▸▸ 發送下一段提示':'▸▸ SEND NEXT SECTION CUE'):(uiLanguage==='zh'?'✓ 歌曲已結束':'✓ END OF SONG');}renderSections(el('song-sections'),s.sections,currentSection,s.sectionInstructions||[]);el('song-sections').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(sync.role==='guest')return;currentSection=+b.dataset.index;sync.sendAppEvent({type:'SECTION',index:currentSong,section:currentSection});const cue=s.sections[currentSection],instruction=(s.sectionInstructions||[])[currentSection]||('Section cue · '+s.title);renderWorshipFull();showCue(cue,currentSection%6,instruction);});
    const nextVisibleIndex=adjacentVisibleSong(currentSong,1),upcoming=songs[nextVisibleIndex];if(el('switch-next')){el('switch-next').disabled=nextVisibleIndex===currentSong||sync.role==='guest';el('switch-next').textContent=nextVisibleIndex===currentSong?(uiLanguage==='zh'?'已是最後一首':'END OF SETLIST'):(uiLanguage==='zh'?'切換至下一首':'SWITCH TO NEXT SONG');}if(el('live-bpm'))el('live-bpm').textContent=sync.bpm;if(el('live-sound'))el('live-sound').textContent=(s.sound||'WOODBLOCK').toUpperCase();if(el('live-start'))el('live-start').textContent=sync.role==='guest'?(sync.followingPaused?(uiLanguage==='zh'?'▶ 繼續跟隨':'▶ CONTINUE FOLLOWING'):(uiLanguage==='zh'?'Ⅱ 本機暫停 BEAT':'Ⅱ PAUSE LOCAL BEAT')):((sync.isPlaying?'Ⅱ STOP SYNC CLICK':'▶ START SYNC CLICK')+' ('+sync.bpm+' BPM)');const progress=el('live-beat-progress');if(progress&&progress.children.length!==sync.beatsPerMeasure)progress.innerHTML=Array.from({length:sync.beatsPerMeasure},(_,i)=>'<i class=\''+(i===0?'active accent-beat':'')+'\'></i>').join('');if(el('next-preview-title'))el('next-preview-title').textContent=upcoming.title;if(el('next-preview-meta'))el('next-preview-meta').innerHTML='<span>'+upcoming.bpm+' BPM</span><span>Key '+safe(upcoming.key)+'</span><span>'+safe(upcoming.signature)+'</span>';
    el('song-list').innerHTML=songs.map((x,i)=>'<div class=\'song-row '+(i===currentSong?'active ':'')+(x.hidden?'hidden-song':'')+'\' data-song-id=\''+safe(x.id)+'\'><b class=drag-handle>⠿</b><div class=row-main data-index='+i+'><strong>'+(i+1)+'. '+safe(x.title)+'</strong><small>'+x.bpm+' BPM · Key '+safe(x.key)+' · '+safe(x.signature)+(x.scoreName?' · '+(x.scorePages||1)+' '+(uiLanguage==='zh'?'頁譜':'score '+((x.scorePages||1)===1?'page':'pages')):'')+'</small></div><div class=song-actions data-index='+i+'><button class=youtube-action data-act=youtube aria-label=YouTube>▶</button><button data-act=score aria-label=Score>♬</button> '+(x.scoreName?'<button data-act=delete-score aria-label=Delete-score title=Delete-score></button>':'')+'<button data-act=hide aria-label=\''+(x.hidden?'Show':'Hide')+'\' title=\''+(x.hidden?'Show':'Hide')+'\'></button><button data-act=copy aria-label=Duplicate title=Duplicate></button><button data-act=edit>Edit</button><button class=danger data-act=delete>Delete</button></div></div>').join('');
    el('song-list').querySelectorAll('.row-main').forEach(n=>n.onclick=()=>selectSong(+n.dataset.index));el('song-list').querySelectorAll('.song-actions button').forEach(b=>b.onclick=async()=>{const i=+b.parentElement.dataset.index,a=b.dataset.act;if(sync.role==='guest'&&!['youtube','score'].includes(a))return;if(a==='youtube'){const song=songs[i],url=song.youtubeUrl||'https://www.youtube.com/results?search_query='+encodeURIComponent(song.title);window.open(url,'_blank','noopener');return;}if(a==='score'){scoreUploadTarget=songs[i];el('score-upload').click();return;}if(a==='delete-score'){if(confirm(uiLanguage==='zh'?'刪除這首歌的所有譜面？':'Delete all score pages for this song?')){await deleteSongScore(songs[i]);renderWorshipFull();}return;}if(a==='edit')editSong(i);if(a==='copy'){songs.splice(i+1,0,Object.assign({},songs[i],{id:'song_'+Date.now(),title:songs[i].title+' Copy',scoreName:''}));}if(a==='hide'){if(!songs[i].hidden&&visibleSongIndexes().length<=1)return;songs[i].hidden=!songs[i].hidden;if(i===currentSong&&songs[i].hidden)currentSong=adjacentVisibleSong(i,1)===i?visibleSongIndexes()[0]:adjacentVisibleSong(i,1);}if(a==='delete'&&songs.length>1&&confirm('Delete '+songs[i].title+'?')){songs.splice(i,1);currentSong=Math.min(currentSong,songs.length-1);}persist();renderWorshipFull();});bindSongReorder();applyUiLanguage();loadScoreForSong(s).catch(console.warn);applyRoleUi();
  }
  renderWorship=renderWorshipFull;renderWorshipFull();
  function focusScoreOnLiveSong(){const viewer=el('score-viewer'),song=songs[currentSong];if(!viewer||!song||!viewer.clientWidth)return;const sheet=[...viewer.querySelectorAll('.score-song-sheet')].find(item=>item.dataset.songId===song.id);if(!sheet)return;viewer.scrollTo({left:sheet.offsetLeft,behavior:'instant'});updateScoreReadingWarning();sizeDoodle();}
  document.querySelectorAll('.worship-tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.worship-tabs button').forEach(x=>x.classList.toggle('active',x===b));const view=b.dataset.wtab,live=view==='live',setlistView=view==='setlist',scoreView=view==='score';document.body.classList.toggle('setlist-page',setlistView&&document.querySelector('.mode-btn[data-mode=worship]')?.classList.contains('active')); document.querySelector('.live-song-shell').classList.toggle('live-control-hidden',!live);document.querySelector('.live-next-card').classList.toggle('live-control-hidden',!live);el('worship-cues').closest('.card-secondary').classList.toggle('live-control-hidden',!live);document.querySelector('.setlist-manager').classList.toggle('setlist-control-hidden',!setlistView);document.querySelector('.setlist-hero').classList.toggle('setlist-control-hidden',!setlistView);document.querySelector('.score-panel').classList.toggle('worship-view-hidden',!scoreView);if(scoreView)requestAnimationFrame(()=>requestAnimationFrame(focusScoreOnLiveSong));});
  document.querySelector('.worship-tabs button[data-wtab=setlist]').click();el('score-upload').onchange=async event=>{const files=event.target.files;if(!files||!files.length)return;try{await saveSongScore(scoreUploadTarget||songs[currentSong],files);renderWorshipFull();}catch(error){console.error(error);alert('Score upload failed: '+error.message);}finally{scoreUploadTarget=null;event.target.value='';}};el('score-fullscreen').onclick=()=>{const panel=document.querySelector('.score-panel');if(document.fullscreenElement){document.exitFullscreen();return;}if(panel.requestFullscreen){panel.requestFullscreen();return;}panel.classList.toggle('score-fullscreen-fallback');el('score-fullscreen').textContent=panel.classList.contains('score-fullscreen-fallback')?'×':'⛶';setFullscreenScoreEditingState();};
  el('add-song').onclick=()=>editSong(null);el('edit-setlist').onclick=editSetlist;
  el('live-minus5').onclick=()=>{changeTempo(-5);renderWorshipFull();};el('live-plus5').onclick=()=>{changeTempo(5);renderWorshipFull();};el('live-start').onclick=()=>{if(sync.role==='guest'){sync.followingPaused?sync.resumeFollowing():sync.pauseFollowing();renderWorshipFull();}else btnPlay.click();};el('switch-next').onclick=()=>queueSongSwitch(adjacentVisibleSong(currentSong,1));el('quick-jump').onclick=()=>{const body='<div class=quick-jump-list>'+visibleSongIndexes().map(index=>{const song=songs[index];return '<button type=button data-jump='+index+'><b>'+(index+1)+'</b><span>'+safe(song.title)+'</span><small>'+song.bpm+' BPM · Key '+safe(song.key)+'</small></button>';}).join('')+'</div>',d=openDialog(uiLanguage==='zh'?'快速跳曲':'Quick Jump',body,()=>true,uiLanguage==='zh'?'關閉':'Close');d.querySelectorAll('[data-jump]').forEach(button=>button.onclick=()=>{queueSongSwitch(+button.dataset.jump);d.close();});};
  el('custom-signature').onclick=()=>{if(sync.role==='guest')return;const body='<div class=field-grid><label>Beats per measure</label><input data-field=beats type=number min=1 max=32 value='+sync.beatsPerMeasure+'><label>Note value</label><select data-field=note><option>2</option><option>4</option><option>8</option><option>16</option><option>32</option></select></div><p class=toast-note>Choose 1–32 beats. Beat 1 starts as an accent; tap any accent button to customize it.</p>';const d=openDialog('Custom Time Signature',body,x=>{const beats=Math.max(1,Math.min(32,+x.querySelector('[data-field=beats]').value||4)),note=+x.querySelector('[data-field=note]').value||4;sync.sendTimeSignature(beats,note);el('custom-signature').textContent=beats+'/'+note+' Custom';updateUI();document.querySelectorAll('.segment-btn').forEach(b=>b.classList.remove('active'));});d.querySelector('[data-field=note]').value=String(sync.noteValue||4);};
  function openLibrary(){const current='<section class=library-section><h3>'+(uiLanguage==='zh'?'從目前歌單存入曲庫':'Save current setlist songs')+'</h3>'+songs.map((song,j)=>'<div class=library-row><span><b>'+safe(song.title)+'</b><small>'+song.bpm+' BPM · '+safe(song.key)+'</small></span><button data-save-library='+j+'>'+(uiLanguage==='zh'?'存入':'Save')+'</button></div>').join('')+'</section>',saved='<section class=library-section><h3>'+(uiLanguage==='zh'?'曲庫歌曲':'Library songs')+'</h3>'+(library.length?library.map((song,j)=>'<div class=library-row><span><b>'+safe(song.title)+'</b><small>'+song.bpm+' BPM · '+safe(song.key)+'</small></span><div><button data-library='+j+'>'+(uiLanguage==='zh'?'加入歌單':'Add')+'</button><button class=danger data-delete-library='+j+'>'+(uiLanguage==='zh'?'刪除':'Delete')+'</button></div></div>').join(''):'<p>'+(uiLanguage==='zh'?'曲庫目前是空的':'The song library is empty')+'</p>')+'</section>',d=openDialog(uiLanguage==='zh'?'歌曲庫':'Song Library','<div class=library-manager>'+current+saved+'</div>',()=>true,uiLanguage==='zh'?'完成':'Done');d.querySelectorAll('[data-save-library]').forEach(button=>button.onclick=event=>{event.preventDefault();const source=songs[+button.dataset.saveLibrary],copy=Object.assign({},source,{id:'library_'+Date.now(),scoreName:'',scorePages:0}),existing=library.findIndex(item=>item.title===copy.title);if(existing>=0)library[existing]=copy;else library.push(copy);persist();d.close();openLibrary();});d.querySelectorAll('[data-library]').forEach(button=>button.onclick=event=>{event.preventDefault();songs.push(Object.assign({},library[+button.dataset.library],{id:'song_'+Date.now()}));persist();renderWorshipFull();});d.querySelectorAll('[data-delete-library]').forEach(button=>button.onclick=event=>{event.preventDefault();const j=+button.dataset.deleteLibrary;if(confirm((uiLanguage==='zh'?'從曲庫刪除：':'Delete from library: ')+library[j].title+'?')){library.splice(j,1);persist();d.close();openLibrary();}});}el('open-library').onclick=openLibrary;
  el('load-template').onclick=()=>{if(confirm(uiLanguage==='zh'?'套用預設敬拜歌單？':'Apply the default worship setlist?')){songs=defaults.map((s,i)=>Object.assign({id:'song_'+Date.now()+'_'+i,capo:'',notes:'',youtubeUrl:'',lyrics:'',hidden:false},s));currentSong=0;persist();renderWorshipFull();}};
  el('share-setlist').onclick=async()=>{const button=el('share-setlist'),old=button.textContent;try{button.textContent=uiLanguage==='zh'?'打包中…':'Packing…';const pack=await createBandPack(),blob=new Blob([JSON.stringify(pack)],{type:'application/json'}),filename='syncbeat-setlist.syncbeat.json',file=new File([blob],filename,{type:'application/json'});if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({title:setlist.name,text:'SyncBeat Band Pack',files:[file]});else{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showCue(uiLanguage==='zh'?'樂團包已儲存':'Band Pack saved',2,filename);}}catch(error){console.error(error);alert('Unable to export Band Pack: '+error.message);}finally{button.textContent=old;}};
  el('sync-setlist').onclick=()=>{if(sync.role==='guest')return;sync.sendAppEvent({type:'SETLIST_SYNC',songs:JSON.parse(JSON.stringify(songs)),setlist:JSON.parse(JSON.stringify(setlist)),currentSong,currentSection});showCue(uiLanguage==='zh'?'歌單已同步給所有樂手':'Setlist synced to all musicians',1,uiLanguage==='zh'?songs.length+' 首歌曲已送出':songs.length+' songs sent');};
  el('import-setlist').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='.json,.syncbeat.json,application/json';input.onchange=async()=>{const file=input.files&&input.files[0];if(!file)return;try{await importBandPack(JSON.parse(await file.text()));showCue(uiLanguage==='zh'?'樂團包已匯入':'Band Pack imported',1,file.name);}catch(error){console.error(error);alert('Unable to import Band Pack: '+error.message);}};input.click();};
  el('edit-practice-sections').onclick=()=>{const body='<label>'+(uiLanguage==='zh'?'歌曲段落（每行一個段落）':'Song sections (one per line)')+'</label><textarea data-field=sections rows=10>'+safe([...el('practice-sections').querySelectorAll('b')].map(x=>x.textContent).join('\\n'))+'</textarea>';openDialog(uiLanguage==='zh'?'編輯歌曲段落':'Edit Song Sections',body,d=>{renderSections(el('practice-sections'),d.querySelector('[data-field=sections]').value.split(/\\n/).map(x=>x.trim()).filter(Boolean));});};
  el('export-practice').onclick=()=>{const title=el('practice-title').value.trim()||(uiLanguage==='zh'?'練習歌曲 ':'Practice Song ')+sync.bpm+' BPM';songs.push({id:'song_'+Date.now(),title,artist:'',bpm:sync.bpm,key:el('practice-key').value||'C',signature:sync.beatsPerMeasure+'/4',capo:el('practice-capo').value,notes:'',youtubeUrl:'',lyrics:'',hidden:false,sections:[...el('practice-sections').querySelectorAll('b')].map(x=>x.textContent)});currentSong=songs.length-1;persist();showCue(uiLanguage==='zh'?'已匯出到敬拜歌單':'Exported to Worship setlist');};
  let swipeStart=0,swipeDelta=0,swipeDirection=0;const swipeCard=el('now-playing'),swipeShell=document.querySelector('.live-song-shell');
  function incomingSongCard(direction){const index=adjacentVisibleSong(currentSong,direction);if(index===currentSong)return null;let card=swipeShell.querySelector('.incoming-song-card');const song=songs[index];if(!card){card=document.createElement('div');card.className='incoming-song-card';swipeShell.appendChild(card);}card.innerHTML='<div class=song-badges><b>SONG '+(index+1)+'/'+songs.length+'</b><span>Key: '+safe(song.key)+'</span><span>'+safe(song.signature)+'</span></div><h2>'+safe(song.title)+'</h2><p>'+song.bpm+' BPM</p>';return card;}
  function resetSwipe(){const incoming=swipeShell.querySelector('.incoming-song-card');swipeCard.classList.remove('swiping');swipeCard.style.transform='';if(incoming)incoming.remove();swipeStart=0;swipeDelta=0;swipeDirection=0;}
  swipeCard.addEventListener('pointerdown',e=>{swipeStart=e.clientX;swipeDelta=0;swipeCard.setPointerCapture(e.pointerId);swipeCard.classList.add('swiping');});
  swipeCard.addEventListener('pointermove',e=>{if(!swipeStart)return;swipeDelta=e.clientX-swipeStart;const direction=swipeDelta<0?1:-1,width=swipeShell.clientWidth;if(direction!==swipeDirection){swipeShell.querySelector('.incoming-song-card')?.remove();swipeDirection=direction;}const incoming=incomingSongCard(direction),atBoundary=!incoming,displayDelta=atBoundary?swipeDelta*.22:swipeDelta;swipeCard.style.transform='translateX('+displayDelta+'px)';if(incoming)incoming.style.transform='translateX('+(displayDelta+(direction>0?width:-width))+'px)';});
  swipeCard.addEventListener('pointerup',()=>{const incoming=swipeShell.querySelector('.incoming-song-card');if(Math.abs(swipeDelta)>75&&incoming&&sync.role!=='guest'){const direction=swipeDirection,width=swipeShell.clientWidth;swipeCard.classList.remove('swiping');swipeCard.style.transform='translateX('+(direction>0?-width:width)+'px)';incoming.style.transform='translateX(0)';setTimeout(()=>{swipeCard.classList.add('swiping');swipeCard.style.transform='';incoming.remove();swipeStart=0;swipeDelta=0;swipeDirection=0;queueSongSwitch(adjacentVisibleSong(currentSong,direction));requestAnimationFrame(()=>swipeCard.classList.remove('swiping'));},280);}else resetSwipe();});
  swipeCard.addEventListener('pointercancel',resetSwipe);

  sync.onStateChange=()=>{updateUI();renderWorshipFull();};
  sync.onAppEvent=payload=>{if(!payload)return;if(payload.type==='SETLIST_SYNC'&&sync.role==='guest'&&Array.isArray(payload.songs)){const localScores=new Map(songs.map(song=>[song.id,{scoreName:song.scoreName,scorePages:song.scorePages}]));songs=payload.songs.map(song=>Object.assign({},song,localScores.get(song.id)||{}));setlist=Object.assign({},setlist,payload.setlist||{});currentSong=Math.max(0,Math.min(songs.length-1,+payload.currentSong||0));currentSection=Math.max(0,+payload.currentSection||0);persist();loadedScoreId='';renderWorshipFull();showCue(uiLanguage==='zh'?'已收到 Host 歌單':'Host setlist received',1,uiLanguage==='zh'?songs.length+' 首歌曲已更新':songs.length+' songs updated',true);}if(payload.type==='SONG_COUNTDOWN')showSongSwitchCountdown(payload.index,payload.count);if(payload.type==='SONG'){clearSongSwitchCountdown();selectSong(payload.index,true);}if(payload.type==='SECTION'){selectSong(payload.index,true);currentSection=Math.max(0,payload.section||0);renderWorshipFull();}if(payload.type==='CUE')showCue(payload.text,payload.tone,payload.subtitle,true);};
  sync.appState={type:'SONG',index:currentSong,section:currentSection};sync.init(initialRoom);sync.restoreCloudRoom();
  updateUI();
  if (wakeToggle.checked) requestWakeLock();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
});
