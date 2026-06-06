// Host test for NAL-aware H.264 framing (v3, length-prefixed).
//
// KEY: models the WebRTC pipeline transform that the first version missed —
// the H264 depacketizer reassembles EVERY NAL with a 4-byte start code
// (00 00 00 01), so the bytes the decryptor sees are NOT the bytes the
// encryptor emitted. The test now runs encrypt -> renormalize-startcodes
// -> decrypt and checks the decoder-visible NAL payloads survive.
#include <cstdint>
#include <cstring>
#include <vector>
#include <cstdio>
#include <random>

static constexpr uint8_t kNalVersion = 3;
static constexpr size_t  kCounterLen = 4;
static constexpr size_t  kTagLen = 16;
static constexpr size_t  kNalBlobHdr = 1 + 4 + 4;   // v|keyId + counter + ptlen

inline size_t FindStartCode(const uint8_t* d, size_t n, size_t from) {
    if (n < 3) return n;
    for (size_t i = from; i + 3 <= n; ++i)
        if (d[i]==0x00 && d[i+1]==0x00 && d[i+2]==0x01) return i;
    return n;
}
inline void EpbEscape(const uint8_t* in, size_t n, std::vector<uint8_t>& out){
    out.clear(); out.reserve(n+(n>>1)+4); size_t z=0;
    for(size_t i=0;i<n;++i){uint8_t b=in[i]; if(z>=2&&b<=0x03){out.push_back(0x03);z=0;} out.push_back(b); z=(b==0)?z+1:0;}
}
inline void EpbUnescape(const uint8_t* in, size_t n, std::vector<uint8_t>& out){
    out.clear(); out.reserve(n); size_t z=0;
    for(size_t i=0;i<n;++i){uint8_t b=in[i]; if(z>=2&&b==0x03&&(i+1<n)&&in[i+1]<=0x03){z=0;continue;} out.push_back(b); z=(b==0)?z+1:0;}
}
static void ksXor(uint32_t c,const uint8_t*in,size_t n,uint8_t*out){for(size_t i=0;i<n;++i)out[i]=in[i]^(uint8_t)((c*2654435761u+i*1103515245u)>>16);}
static std::vector<uint8_t> gcmEnc(uint32_t c,const uint8_t*in,size_t n){std::vector<uint8_t>r(n+kTagLen);ksXor(c,in,n,r.data());for(size_t i=0;i<kTagLen;++i)r[n+i]=(uint8_t)(0xA0+i);return r;}
static std::vector<uint8_t> gcmDec(uint32_t c,const uint8_t*in,size_t n,bool*ok){*ok=false;if(n<kTagLen)return{};size_t pl=n-kTagLen;for(size_t i=0;i<kTagLen;++i)if(in[pl+i]!=(uint8_t)(0xA0+i))return{};std::vector<uint8_t>r(pl);ksXor(c,in,pl,r.data());*ok=true;return r;}

static uint32_t g_ctr=0;
static std::vector<uint8_t> EncryptH264(const std::vector<uint8_t>& f){
    const uint8_t* in=f.data(); size_t n=f.size(); std::vector<uint8_t> out,blob,esc; size_t i=0;
    while(i<n){
        size_t sc=FindStartCode(in,n,i); if(sc==n){out.insert(out.end(),in+i,in+n);break;}
        size_t hp=sc+3; if(hp>=n){out.insert(out.end(),in+i,in+n);break;}
        out.insert(out.end(),in+i,in+hp+1);
        size_t bs=hp+1,ns=FindStartCode(in,n,bs),be=(ns==n)?n:ns,bl=be-bs;
        uint8_t nalType=in[hp]&0x1f;
        if(nalType<1||nalType>5){ out.insert(out.end(),in+bs,in+be); i=be; continue; } // non-VCL: clear
        uint32_t c=g_ctr++; auto ct=gcmEnc(c,in+bs,bl);
        blob.resize(kNalBlobHdr+bl+kTagLen);
        blob[0]=(uint8_t)((kNalVersion<<4)|0x05);
        blob[1]=(c>>24)&0xff;blob[2]=(c>>16)&0xff;blob[3]=(c>>8)&0xff;blob[4]=c&0xff;
        blob[5]=(bl>>24)&0xff;blob[6]=(bl>>16)&0xff;blob[7]=(bl>>8)&0xff;blob[8]=bl&0xff;
        memcpy(blob.data()+kNalBlobHdr,ct.data(),ct.size());
        EpbEscape(blob.data(),blob.size(),esc); out.insert(out.end(),esc.begin(),esc.end());
        i=be;
    }
    return out;
}
static std::vector<uint8_t> DecryptH264(const std::vector<uint8_t>& e){
    const uint8_t* in=e.data(); size_t n=e.size(); std::vector<uint8_t> out,un; size_t i=0;
    while(i<n){
        size_t sc=FindStartCode(in,n,i); if(sc==n){out.insert(out.end(),in+i,in+n);break;}
        size_t hp=sc+3; if(hp>=n){out.insert(out.end(),in+i,in+n);break;}
        out.insert(out.end(),in+i,in+hp+1);
        size_t bs=hp+1,ns=FindStartCode(in,n,bs),be=(ns==n)?n:ns,bl=be-bs;
        auto pass=[&](){out.insert(out.end(),in+bs,in+be);};
        EpbUnescape(in+bs,bl,un);
        if(un.size()<kNalBlobHdr+kTagLen){pass();i=be;continue;}
        uint8_t v=un[0]; if(((v>>4)&0xf)!=kNalVersion||(v&0xf)!=0x05){pass();i=be;continue;}
        const uint8_t* cp=un.data()+1; uint32_t c=((uint32_t)cp[0]<<24)|((uint32_t)cp[1]<<16)|((uint32_t)cp[2]<<8)|cp[3];
        const uint8_t* pl=un.data()+1+kCounterLen;
        size_t ptl=((size_t)pl[0]<<24)|((size_t)pl[1]<<16)|((size_t)pl[2]<<8)|pl[3];
        size_t ctl=ptl+kTagLen; if(kNalBlobHdr+ctl>un.size()){pass();i=be;continue;}
        bool ok; auto pt=gcmDec(c,un.data()+kNalBlobHdr,ctl,&ok);
        if(!ok||pt.size()!=ptl){pass();i=be;continue;}
        out.insert(out.end(),pt.begin(),pt.end());
        i=be;
    }
    return out;
}
// Simulate WebRTC H264 depacketizer: split on start codes, re-emit each NAL
// (header+body) with a 4-byte start code. This is the transform the first
// version of the code didn't account for.
static std::vector<uint8_t> Renormalize4ByteStartCodes(const std::vector<uint8_t>& s){
    const uint8_t* in=s.data(); size_t n=s.size(); std::vector<uint8_t> out; size_t i=0;
    while(i<n){
        size_t sc=FindStartCode(in,n,i); if(sc==n) break;
        size_t nalStart=sc+3; size_t ns=FindStartCode(in,n,nalStart); size_t nalEnd=(ns==n)?n:ns;
        // strip trailing zeros that belonged to the next 4-byte start code
        size_t end=nalEnd; while(end>nalStart && in[end-1]==0x00) end--;
        const uint8_t scode[4]={0,0,0,1};
        out.insert(out.end(),scode,scode+4);
        out.insert(out.end(),in+nalStart,in+end);
        i=nalEnd;
    }
    return out;
}
// Decoder-visible canonical form: list of (header + body-with-trailing-zeros-stripped).
static std::vector<std::vector<uint8_t>> Canonical(const std::vector<uint8_t>& s){
    std::vector<std::vector<uint8_t>> nals; const uint8_t* in=s.data(); size_t n=s.size(); size_t i=0;
    while(i<n){
        size_t sc=FindStartCode(in,n,i); if(sc==n)break;
        size_t hs=sc+3; if(hs>=n)break;
        size_t ns=FindStartCode(in,n,hs+1); size_t be=(ns==n)?n:ns;
        size_t end=be; while(end>hs && in[end-1]==0x00) end--; // strip trailing zeros
        nals.emplace_back(in+hs,in+end);
        i=be;
    }
    return nals;
}
static bool hasFalseStartInBodies(const std::vector<uint8_t>& enc){
    const uint8_t* in=enc.data(); size_t n=enc.size(); size_t i=0;
    while(i<n){size_t sc=FindStartCode(in,n,i);if(sc==n)break;size_t hp=sc+3;if(hp>=n)break;
        size_t bs=hp+1,ns=FindStartCode(in,n,bs),be=(ns==n)?n:ns;
        if(FindStartCode(in,be,bs)!=be)return true; i=be;}
    return false;
}

// Append an EPB-clean random body (real H264 RBSP never contains 00 00 0x).
static void genBody(std::vector<uint8_t>& frame, std::mt19937& rng){
    size_t bl=rng()%50; std::vector<uint8_t> raw(bl), esc;
    for(size_t j=0;j<bl;++j) raw[j]=(rng()%4==0)?0x00:(uint8_t)rng();
    EpbEscape(raw.data(),raw.size(),esc);
    frame.insert(frame.end(),esc.begin(),esc.end());
}

int main(){
    std::mt19937 rng(777);
    long frames=0, multiNal=0;
    for(int t=0;t<60000;++t){
        g_ctr=rng();
        std::vector<uint8_t> frame;
        int nals=1+rng()%6; if(nals>1)multiNal++;
        for(int k=0;k<nals;++k){
            // randomize 3- vs 4-byte start code on the ENCODER side
            if(rng()&1){frame.push_back(0);frame.push_back(0);frame.push_back(0);frame.push_back(1);}
            else{frame.push_back(0);frame.push_back(0);frame.push_back(1);}
            // realistic NAL types: keyframe = SPS(0x67) PPS(0x68) IDR(0x65),
            // then non-IDR slices(0x41). exercises non-VCL passthrough + VCL crypto.
            uint8_t hdr = (k==0)?0x67 : (k==1)?0x68 : (k==2)?0x65 : 0x41;
            frame.push_back(hdr);
            genBody(frame,rng);
        }
        auto enc=EncryptH264(frame);
        if(hasFalseStartInBodies(enc)){printf("FAIL false start code t=%d\n",t);return 1;}
        // *** the transform the bug hid behind ***
        auto wire=Renormalize4ByteStartCodes(enc);
        auto dec=DecryptH264(wire);
        if(Canonical(dec)!=Canonical(frame)){printf("FAIL payload mismatch after renormalize t=%d nals=%d\n",t,nals);return 1;}
        frames++;
    }
    printf("PASS: encrypt -> depacketizer-renormalize -> decrypt preserves NAL payloads\n");
    printf("      (%ld frames, %ld of them multi-NAL)\n",frames,multiNal);

    // plaintext passthrough still works (peer not yet encrypting)
    for(int t=0;t<20000;++t){
        std::vector<uint8_t> frame;
        int nals=1+rng()%5;
        for(int k=0;k<nals;++k){frame.push_back(0);frame.push_back(0);frame.push_back(1);
            frame.push_back((uint8_t)(0x41+(rng()%0x20)));
            genBody(frame,rng);}
        auto wire=Renormalize4ByteStartCodes(frame);
        auto dec=DecryptH264(wire);
        if(Canonical(dec)!=Canonical(frame)){printf("FAIL passthrough t=%d\n",t);return 1;}
    }
    printf("PASS: plaintext passthrough through the same pipeline\n");
    printf("ALL TESTS PASSED\n");
    return 0;
}
