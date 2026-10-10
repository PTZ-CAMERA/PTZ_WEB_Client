// VMS /ws로 SDP를 교환한다. 외부 WHEP 요청은 없다.
class NativeWebRtcReceiver {
  constructor({ send, onTrack, onError }) {
    this.send = send; this.onError = onError; this.closed = false;
    this.pc = new RTCPeerConnection({ iceServers: [] }); this.pc.ontrack = onTrack;
    this.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(this.pc.connectionState) && !this.closed) this.fail('WebRTC 연결 종료');
    };
    this.timer = setTimeout(() => this.fail('WebRTC 연결 시간 초과'), 20000);
    this.connect().catch(error => this.fail(error.message));
  }
  call(command, fields = {}) {
    return new Promise((resolve, reject) => {
      if (!this.send(command, fields, resolve, reason => reject(new Error(reason)), 20000)) reject(new Error('VMS 연결이 없습니다.'));
    });
  }
  async connect() {
    const offer = await this.call('WEBRTC_START'); if (this.closed) return;
    if (offer.type !== 'offer' || typeof offer.sdp !== 'string' || typeof offer.clientId !== 'string') throw new Error('잘못된 WebRTC offer');
    this.clientId = offer.clientId;
    await this.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gather(); if (this.closed) return;
    await this.call('WEBRTC_ANSWER', { clientId: this.clientId, sdp: this.pc.localDescription.sdp });
  }
  gather() {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const end = () => { clearTimeout(timer); this.pc.removeEventListener('icegatheringstatechange', changed); };
      const changed = () => { if (this.pc.iceGatheringState === 'complete') { end(); resolve(); } };
      const timer = setTimeout(() => { end(); reject(new Error('ICE 후보 수집 시간 초과')); }, 5000);
      this.pc.addEventListener('icegatheringstatechange', changed);
    });
  }
  fail(message) { if (!this.closed) { this.close(); this.onError(message); } }
  confirmFrames() { clearTimeout(this.timer); }
  close() {
    if (this.closed) return; this.closed = true; clearTimeout(this.timer);
    this.pc.ontrack = null; this.pc.onconnectionstatechange = null; this.pc.close(); this.send('WEBRTC_STOP', {});
  }
}
window.NativeWebRtcReceiver = NativeWebRtcReceiver;
