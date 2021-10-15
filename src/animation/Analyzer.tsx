// HMJ
import * as THREE from 'three';
import React, {
  forwardRef,
  useEffect,
  useRef,
  useMemo,
  useImperativeHandle,
  useState,
} from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { /*useAnimations,*/ useFBO, useGLTF } from '@react-three/drei';
import glsl from 'babel-plugin-glsl/macro';

import { colorLookupTable, Pow2 } from './colour-lookup-table';
/**
 * ## Rendering Pipeline: webgl + three.js ###
 *
 * (note: I've added in the gltf version of the glb file in the /public directory, in order that you can
 * more easily see the different buffers contained within the model)
 *
 * GLB model includees a set of meshes. Meshes are made up of triangular faces, which in turn are made up of
 * vertices and edges. Often meshes are represented as buffers of vertices, edges, and indices (which index whhich
 * vertex/edge belongs to which face).
 * The vertices often have data attached to them, known as vertex attributes. Your glb model has 3 vertex attributes:
 * - POSITION (i.e. the position of the vertex in so-called 'model space'),
 * - NORMAL (a 3-vector representing the direction of the 'normal' on the geoemtry at that vertex),
 * - TEXCOORD_0 (a uv coordinate, which helps to map 2-d textures onto the surface of the geometry)
 *
 * In the actual vertex shader, these attributes will look like this:
 * 	 💉 injected attributes:  ✅
 * attribute vec3 position; //POSITION ✅
 * attribute vec3 normal; //NORMAL ✅
 * attribute vec3 tangent; //TANGENT
 * attribute vec2 uv; //TEXCOORD_0 ✅
 * attribute vec2 uv2; //TEXCOORD_1
 * attribute vec4 color; //COLOR_0
 * attribute vec3 skinWeight; //WEIGHTS_
 * attribute vec3 skinIndex; //JOINTS_0
 *
 * Three.js is just a wrapper around webgl, which is an api for dealing with the graphic piepline at a low level. Meshes
 * are sent through a graphics pipeline, and decomposed into their constituent faces. They generally go through a so-called
 * 'vertex shader', which manipulates the positions of the vertices (i.e. we need to go from the model space coordinate system to
 * the homogenous clip space, which is the final 2d representation you get on the screen). During this process you can write custom
 * shaders to add effects to where the individual vertices of the gometry are position. This is usally achieved by feeding in 'uniforms',
 * which is data passed from the CPU on an often per frame basis (i.e. mouse position, camera position). Three.js already injectes
 * some of theese uniforms for us.
 *
 * Next, the triangles are 'rasterized' into pizels, and sent off to the fragment shader, which colours the 'fragments' of  the triangles
 * We can write a custom fragment shader to influence the colouring.
 *
 * What uniforms should we pass in from the CPU to influence our mesh. Some we already get for free:
 * uniform mat4 modelMatrix; ✅ 			// = object.matrixWorld
 * uniform mat4 modelViewMatrix; ✅ 	// = camera.matrixWorldInverse * object.matrixWorld
 * uniform mat4 projectionMatrix; ✅ 	// = camera.projectionMatrix
 * uniform mat4 viewMatrix; ✅				// = camera.matrixWorldInverse
 * uniform mat3 normalMatrix; ✅			// = inverse transpose of modelViewMatrix
 * uniform vec3 cameraPosition; ✅		// = camera position in world space
 *
 * We probably also want data on
 *  - mouse
 * 	- audio
 */

//eslint-disable-next-line
const vertexShader = glsl`
  // #define FFT_SIZE

	//This uniform is fed into the GPU via a buffer
	uniform vec2 mouse;
	//Samplers encapsulate the various render states associated with reading textures: coordinate system, addressing mode, and filtering
	//We can create them from within the shader, but easier to just feed it in. 
	uniform sampler2D tAudioData;
	uniform float sampleRate; 
	/**
	 * Bit of physics: sound is made up of the superposition of waves. The basis vectors of these waves (i.e. the  basic building blocks) 
	 * are sinθ and cosθ waves of different frequencies with different amplitudes. 
	 * We can do the fourier transform on these waves to determine what what are the specific frequencies of waves which make up the sound, and
	 * in what proprtion. Music is transient (i.e it changes from momeent to moment), so we need to keep resampling, and doing the fourier transform.
	 * On computers, we can approximate fourier transform using the fast fourier transform, which requires a given interval of time, dt.  
	 * 
	 * By doing the FFT, we get, for each time period dt, a historgram of values, where each bin represents a particular frequency band of the waves. We 
	 * generally visualise this via spectograms. In our case, we will get another historgram of frequency band values for every time period. We can visalise 
	 * this using a spectogram.
	 * 
	 * In order to 'save to memory' this historical frequency band data, we render the latest information into a row of a texture. On the next interval
	 * we increment the row by one, and render the next row of data in. [note: RTT - rener to texture].
	 */
	uniform sampler2D tSpectogram;
	uniform vec3 colorLookupTable[HALF_FFT_SIZE];

	varying vec3 vPosition; 
	varying vec2 vUv; 
	varying vec3 vNormal; 



	 void main()
	 {
		 // pass vertex attributes to frag shader via varyings:
			vPosition = position; 
			vUv = uv; 
			vNormal = normal; 


			// note: this is a 1-d array. There is a wrapping on the texture, which means when we read from coordinates outside
			// the domain, it wraps back on itself


			

	 
	 
			vec4 modelPosition = modelMatrix * vec4( vec3(position.x, position.y, position.z), 1.0);
			vec4 viewPosition = viewMatrix * modelPosition;
			vec4 projectionPosition = projectionMatrix * viewPosition;
			gl_Position = projectionPosition;
	}
`;

const fragmentShader = glsl`
// #pragma glslify: blend = require("../../shaders/functions/glsl-blend/add.glsl")
uniform vec2 mouse;
uniform sampler2D tAudioData;
uniform float sampleRate; 
uniform sampler2D tSpectogram;
uniform vec3 colorLookupTable[HALF_FFT_SIZE]; 


varying vec3 vPosition; 
varying vec2 vUv; 
varying vec3 vNormal; 



void main()
{
	// vec4 fourier_transform = fft(tAudioData, resolution, subtransformSize, horizontal, forward, normalization);

	// I think all the data is packed into the .r channel, but whatever... 
	vec4 sound = texture2D( tAudioData, vec2( vUv.x, vUv.y ) ); // <- I'm really not sure in which format this data comes out... Does interpolation occut?
			// int soundIndex = int(sound.r) * int(255); // <- I think sound is all between 0-1
			// vColor = colorLookupTable[soundIndex]; 
	vec3 color = vec3(sound.r, 0., 0.);
	
	
  gl_FragColor = vec4(color, 1.);
}
`;

type SpectogramTextureProps = { size?: number };

//eslint-disable-next-line
const SpectogramTexture = forwardRef<unknown, SpectogramTextureProps>(({ size }, ref) => {
  const dpr = useThree((state) => state.viewport.dpr);
  const { width, height } = useThree((state) => state.size);
  const w = size || width * dpr;
  const h = size || height * dpr;

  const fboSettings: THREE.WebGLRenderTargetOptions = useMemo(() => {
    return {};
  }, [w, h]);

  const spectogramFBO = useFBO(w, h, fboSettings);

  useImperativeHandle(ref, () => spectogramFBO.texture);

  return useFrame((state) => {
    state.gl.setRenderTarget(spectogramFBO);
    state.gl.render(state.scene, state.camera);
    state.gl.setRenderTarget(null);
  });
});

// We can represent the audio data in different ways:
//eslint-disable-next-line
type RepresentationADT = { kind: 'morph-target-displacement' } | { kind: 'spectogram' };

const GROUP_SCALE = 2.23;
// const DEFAULT_MESH_SCALE = 0.25;

type AnalyzerPropsType = {
  isLinear: boolean;
  hasRainbowColor: boolean;
};

const Analyzer = forwardRef<THREE.Audio<AudioNode>, AnalyzerPropsType>((props, forwardedRef) => {
  const { gl, mouse } = useThree();

  // eslint-disable-next-line
  const [spectogramTexture, setSpectogramTexture] = useState<THREE.Texture>(null!);

  const sound = forwardedRef as React.RefObject<THREE.Audio<AudioNode>>;
  const mesh = useRef<THREE.Mesh>(null!);
  const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null!);

  const analyser = useRef<THREE.AudioAnalyser>(null!);
  const FFT_SIZE: Pow2 = 512; // A non-zero power of two up to 2048, representing the size of the FFT (Fast Fourier Transform) to be used to determine the frequency domain.
  const HALF_FFT_SIZE: Pow2 = 256;
  const format = gl.capabilities.isWebGL2 ? THREE.RedFormat : THREE.LuminanceFormat;

  const group = useRef();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  // const { nodes, animations } = useGLTF('/cubetesting_metalic.glb');
  // const { actions } = useAnimations(animations, group);
  useEffect(() => {
    if (mesh.current != null) {
      const morphs = mesh.current.morphTargetDictionary;

      if (morphs != null) {
        morphs.Displace = 0.3;
        mesh.current.morphTargetInfluences = [0.12];
      }
    }
  });

  useEffect(() => {
    if (sound.current) {
      analyser.current = new THREE.AudioAnalyser(sound.current, FFT_SIZE);
    }
  }, []);

  const colorLookupVec3Array = useMemo(() => {
    return colorLookupTable[HALF_FFT_SIZE].map(
      (colorTriplet) => new THREE.Vector3(colorTriplet[0], colorTriplet[1], colorTriplet[2]),
    );
  }, []);

  const initialUniforms = useMemo(() => {
    return {
      mouse: { value: mouse },
      tAudioData: { value: THREE.Texture.DEFAULT_IMAGE },
      tSpectogram: { value: THREE.Texture.DEFAULT_IMAGE },
      sampleRate: { value: 0 },
      colorLookupTable: { value: colorLookupVec3Array, type: '' },
    };
  }, []);

  useFrame(({ mouse }) => {
    /**
     * analyser.getFrequencyData() uses the Web Audio's
     * getByteFrequencyData method.
     * Returns array of half size of fftSize.
     * ex. if fftSize = 2048, array size will be 1024.
     * data includes magnitude of low ~ high frequency.
     * The frequency data is composed of integers on a scale from 0 to 255.
     * Each item in the array represents the decibel value for a specific frequency.
     * The frequencies are spread linearly from 0 to 1/2 of the sample rate.
     * For example, for 48000 sample rate, the last item of the array will represent the decibel value for 24000 Hz
     * see: https://stackoverflow.com/questions/14789283/what-does-the-fft-data-in-the-web-audio-api-correspond-to/14789992#14789992
     */
    const frequencyData: Uint8Array = analyser.current.getFrequencyData();
    //eslint-disable-next-line
    const frequencyDataBufferLenght = analyser.current.analyser.frequencyBinCount;
    //eslint-disable-next-line
    const sampleRate: number = analyser.current.analyser.context.sampleRate;
    //eslint-disable-next-line
    const nyquistFrequency: number = 0.5 * sampleRate;

    // const averageFrequencyData: number = analyser.current.getAverageFrequency();

    // if (mesh.current && Object.keys(actions).length > 0 && averageFrequencyData >= 50) {
    //   const displacementValue = averageFrequencyData / 200;

    //   if (mesh.current.morphTargetDictionary) {
    //     mesh.current.morphTargetDictionary.Displace = displacementValue;
    //   }
    //   mesh.current.morphTargetInfluences = [displacementValue];
    // }

    // update our uniforms imperatively
    shaderMaterialRef.current.uniforms.mouse.value = mouse;
    shaderMaterialRef.current.uniforms.mouse.value.needsUpdate = true;
    shaderMaterialRef.current.uniforms.tAudioData.value = new THREE.DataTexture(
      frequencyData,
      FFT_SIZE / 2,
      1,
      format,
    );
    shaderMaterialRef.current.uniforms.tAudioData.value.needsUpdate = true;
    shaderMaterialRef.current.uniforms.sampleRate.value = sampleRate;
    // shaderMaterialRef.current.uniforms.sampleRate.value.needsUpdate = true;
    shaderMaterialRef.current.uniforms.tSpectogram.value = spectogramTexture;
    shaderMaterialRef.current.uniforms.tSpectogram.value.needsUpdate = true;

    shaderMaterialRef.current.uniforms.colorLookupTable.value = colorLookupVec3Array;
  });

  // useFrame((_state, delta) => {
  //   if (mesh.current && mesh.current.rotation) {
  //     mesh.current.rotation.x -= (0.01 * Math.PI) / 180;
  //     mesh.current.rotation.y += delta * 0.15;
  //   }
  // });

  return (
    <>
      <SpectogramTexture ref={setSpectogramTexture} size={FFT_SIZE / 2} />
      <group ref={group} dispose={null}>
        <group name="Armature" position={[0, 0, 0]} scale={GROUP_SCALE}>
          <mesh ref={mesh}>
            <planeBufferGeometry args={[2, 2]} />
            {analyser.current ? (
              <shaderMaterial
                ref={shaderMaterialRef}
                alphaTest={0}
                attach="material"
                defines={{
                  HALF_FFT_SIZE,
                }}
                fragmentShader={fragmentShader}
                side={THREE.DoubleSide}
                uniforms={initialUniforms}
                vertexShader={vertexShader}
                depthWrite
                vertexColors
                // needsUpdate={true}
                // uniformsNeedUpdate={true}
              />
            ) : (
              <meshBasicMaterial />
            )}
          </mesh>
        </group>
      </group>
    </>
  );
});

useGLTF.preload('/cubetesting_metalic.glb');

export default Analyzer;
