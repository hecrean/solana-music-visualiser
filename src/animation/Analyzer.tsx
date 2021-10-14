// HMJ
import * as THREE from 'three';
import React, { forwardRef, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';

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
const uniformsGlsl = /*glsl*/ `
	//This uniform is fed into the GPU via a buffer
	struct Mouse {
		vec2 position;
		bool left_button_state; //true for down; false for up
		bool right_button_state; // ^ as above
		bool middle_button_state; // ^ as above
	}
	uniform Mouse mouse;

	//Samplers encapsulate the various render states associated with reading textures: coordinate system, addressing mode, and filtering
	//We can create them from within the shader, but easier to just feed it in. 
	uniform sampler2D tAudioData;
	uniform float sampleRate; 
`;

// We can represent the audio data in different ways:
//eslint-disable-next-line
type RepresentationADT = { kind: 'morph-target-displacement' } | { kind: 'spectogram' };

const GROUP_SCALE = 2.23;
const DEFAULT_MESH_SCALE = 0.25;

type AnalyzerPropsType = {
  isLinear: boolean;
  hasRainbowColor: boolean;
};

const Analyzer = forwardRef<THREE.Audio<AudioNode>, AnalyzerPropsType>(
  ({ hasRainbowColor, isLinear }, forwardedRef) => {
    const sound = forwardedRef as React.RefObject<THREE.Audio<AudioNode>>;
    const mesh = useRef<THREE.Mesh>(null!);
    const shaderMaterialRef = useRef<THREE.ShaderMaterial>(null!);

    const analyser = useRef<THREE.AudioAnalyser>(null!);
    const { gl } = useThree();
    const FFT_SIZE = 128; // A non-zero power of two up to 2048, representing the size of the FFT (Fast Fourier Transform) to be used to determine the frequency domain.
    const format = gl.capabilities.isWebGL2 ? THREE.RedFormat : THREE.LuminanceFormat;

    const group = useRef();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { nodes, materials, animations } = useGLTF('/cubetesting_metalic.glb');
    const { actions } = useAnimations(animations, group);
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
    useFrame(({ mouse }) => {
      if (analyser.current) {
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
         */
        const frequencyData: Uint8Array = analyser.current.getFrequencyData();
        //eslint-disable-next-line
        const frequencyDataBufferLenght = analyser.current.analyser.frequencyBinCount;
        //eslint-disable-next-line
        const sampleRate: number = analyser.current.analyser.context.sampleRate;

        const averageFrequencyData: number = analyser.current.getAverageFrequency();

        if (mesh.current && Object.keys(actions).length > 0 && averageFrequencyData >= 50) {
          const displacementValue = averageFrequencyData / 200;

          if (mesh.current.morphTargetDictionary) {
            mesh.current.morphTargetDictionary.Displace = displacementValue;
          }
          mesh.current.morphTargetInfluences = [displacementValue];
        }

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
      }
    });

    useFrame((_state, delta) => {
      if (mesh.current && mesh.current.rotation) {
        mesh.current.rotation.x -= (0.01 * Math.PI) / 180;
        mesh.current.rotation.y += delta * 0.15;
      }
    });

    return (
      <group ref={group} dispose={null}>
        <group name="Armature" position={[0, -1, 0]} scale={GROUP_SCALE}>
          <mesh
            ref={mesh}
            geometry={nodes.Globe_1.geometry}
            material={materials['spherematerial.001']}
            morphTargetDictionary={nodes.Globe_1.morphTargetDictionary}
            morphTargetInfluences={nodes.Globe_1.morphTargetInfluences}
            name="Globe_1"
            position={[0, 0.49, 0]}
            scale={DEFAULT_MESH_SCALE + 0.02}
          >
            {hasRainbowColor ? (
              <meshNormalMaterial wireframe={isLinear} />
            ) : (
              <meshPhongMaterial color="#505050" shininess={10} wireframe={isLinear} />
            )}
          </mesh>
        </group>
      </group>
    );
  },
);

useGLTF.preload('/cubetesting_metalic.glb');

export default Analyzer;
