import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { createFakeServices } from './services';
import { createEnvironmentStore, memoryEnvironmentStorage } from './shell/environment';

describe('App', () => {
  it('枠を描く', () => {
    // jsdom には 2D コンテキストが無いので、描画は何もしないものにする
    const services = {
      ...createFakeServices(),
      createRenderer: () => ({ init() {}, setTextures() {}, render() {}, dispose() {} }),
    };
    render(<App services={services} environment={createEnvironmentStore(memoryEnvironmentStorage())} />);
    expect(screen.getByTestId('app-root')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'モデリング' })).toBeTruthy();
  });
});
